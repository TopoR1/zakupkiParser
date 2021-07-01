import express from 'express';
import httpProtocol from 'http';
import socketIO from 'socket.io';
import session from 'express-session';
import expressip from 'express-ip';
import bodyParser from 'body-parser';
import Logger from './modules/logger.js';
import md5 from 'md5';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import FeedParser from 'feedparser';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
import mongodb from './modules/db.js';
import nodemailer from 'nodemailer';
import { JSDOM } from 'jsdom';
import excel from 'excel4node';
import fs from 'fs';

let parser = new Parser();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const http = httpProtocol.createServer(app);
const io = socketIO(http);
const urlencodedParser = bodyParser.urlencoded({extended: false});
const salt = '1Kxz9T'; // секретное слово
const recaptcha = {
    key: {
        v2: '', // ключ рекапчи гугл для сервера (2 версия)
        v3: '' // ключ рекапчи гугл для сервера (3 версия)
    }
};
const tracksOnly = [];
const transport = nodemailer.createTransport({
    service: 'Gmail', // почта
    auth: {
        user: '', // адрес
        pass: '' // пароль
    }
});

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.set('trust proxy', true);

app.use(expressip().getIpInfoMiddleware);
app.use(bodyParser.json());
app.use('/assets', express.static('assets'));
app.use(
    session({
        secret: salt,
        resave: true,
        saveUninitialized: false
    })
);

app.get('/auth', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });
    
    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.redirect('/track');

    res.render('sign', {
        type: 'auth',
        form: '',
        showEmail: false
    });
});

app.post('/auth', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.send({redirect: '/auth'});

    const type = req.body.type;
    let response  = null;
    try {
        response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${type == 'v3' ? recaptcha.key.v3 : recaptcha.key.v2}&response=${req.body.recaptcha}`, {
            method: 'POST',
            timeout: 5000
        });
    } catch(err) {
        return res.send({
            alert: {
                type: 'error',
                message: 'Сервер не смог проверить капчу. Повторите позже...'
            }
        });
    }

    if (!response) return res.send({
        alert: {
            type: 'error',
            message: 'Сервер не смог проверить капчу. Повторите позже...'
        }
    });

    const recaptchaResult = await response?.json();
    const obj = {};

    if (recaptchaResult?.success && ((type == 'v3' && recaptchaResult?.score >= 0.75) || type == 'v2')) {
        const login = req.body?.login;
        const password = req.body?.password;

        if (!login) return res.send({
            error: true,
            login: true,
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (!password) return res.send({
            error: true,
            password: true,
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });

        const user = await getUser({
            $or: [{
                name: login
            }, {
                email: login
            }]
        });

        if (!user) return res.send({
            error: true,
            login: true,
            alert: {
                type: 'error',
                message: 'Неверное Имя или Email'
            }
        });
        if (user?.password != md5(password + salt)) return res.send({
            error: true,
            password: true,
            alert: {
                type: 'error',
                message: 'Неверный пароль'
            }
        });
        if (!user.activate.val) return res.send({
            error: true,
            alert: {
                type: 'error',
                message: 'Аккаунт не активирован. Авторизация невозможна.'
            }
        });
    
        const update = {
            $set: {
                lastAuth: Date.now(),
                lastRequest: Date.now()
            }
        }

        const sessions = user.sessions.find(item => item.id == sessionID && item.agent == req.headers['user-agent']);

        if (!sessions) {
            update.$push = { 
                sessions: {
                    id: sessionID,
                    ip: req.ipInfo.ip,
                    agent: req.headers['user-agent'],
                    time: Date.now(),
                    auth: 1
                }
            }
        } else {
            sessions.auth++;
            update.$set.sessions = user.sessions;
        }

        await mongodb.db.collection('users').updateOne({
            id: user.id
        }, update);
        obj.redirect = '/track';
    } else {
        obj.recaptcha = true;
    }
    res.send(obj);
});

app.get('/signup', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.redirect('/track');

    if (req.query.key) {
        const activater = await mongodb.db.collection('users').findOne({'activate.key_url': req.query.key});

        if (activater) {
            if (activater.activate.val) return res.render({
                type: 'fa_email',
                key: activater.activate.key_url,
                form: 'signup',
                showEmail: true
            });
    
            return res.render('sign', {
                type: 'fa_email',
                key: activater.activate.key_url,
                form: 'signup',
                showEmail: true
            });
        }
    }

    res.render('sign', {
        type: 'signup',
        form: 'signup',
        showEmail: false
    });
});

app.post('/signup', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.send({redirect: '/track'});

    const type = req.body.type;
    let response  = null;
    try {
        response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${type == 'v3' ? recaptcha.key.v3 : recaptcha.key.v2}&response=${req.body.recaptcha}`, {
            method: 'POST',
            timeout: 5000
        });
    } catch(err) {
        return res.send({
            alert: {
                type: 'error',
                message: 'Сервер не смог проверить капчу. Повторите позже...'
            }
        });
    }

    if (!response) return res.send({
        alert: {
            type: 'error',
            message: 'Сервер не смог проверить капчу. Повторите позже...'
        }
    });

    const recaptchaResult = await response?.json();
    const obj = {};

    if (recaptchaResult?.success && ((type == 'v3' && recaptchaResult?.score >= 0.75) || type == 'v2')) {
        if (req.body.key) {
            const activater = await mongodb.db.collection('users').findOne({'activate.key_url': req.body.key});

            if (!activater) return res.send({alert: {message: 'Ссылка на активацию недействительна', type: 'error'}});
            if (activater.activate.val) return res.send({alert: {message: 'Аккаунт уже активирован', type: 'error'}});
            if (activater.activate.key_email != req.body.code) return res.send({alert: {message: 'Неверный код', type: 'error'}, error: true, key: true});

            activater.activate.val = true;
            activater.sessions.push({
                id: sessionID,
                ip: req.ipInfo.ip,
                agent: req.headers['user-agent'],
                time: Date.now(),
                auth: 1
            });

            await mongodb.db.collection('users').updateOne({
                id: activater.id
            }, {
                $set: {
                    activate: activater.activate,
                    sessions: activater.sessions
                }
            });

            return res.send({redirect: '/track'});
        }

        const name = req.body?.name?.trim();
        const email = req.body?.email?.trim();
        const password = req.body?.password?.trim();
        const policy = req.body?.policy;
        const news = req.body?.news;
        const pattern = /^([a-z0-9_\.-])+@[a-z0-9-]+\.([a-z]{2,4}\.)?[a-z]{2,4}$/i;
        
        if (!name) return res.send({
            error: true, 
            name: true, 
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (name.length < 4) return res.send({
            error: true, 
            name: true, 
            alert: {
                type: 'warning',
                message: 'Слишком короткое имя'
            }
        });
        if (!email) return res.send({
            error: true, 
            email: true, 
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (!pattern.test(email)) return res.send({
            error: true, 
            email: true, 
            alert: {
                type: 'warning',
                message: 'Проверьте правильность введённого Email'
            }
        });
        if (!password) return res.send({
            error: true, 
            password: true, 
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (password.length < 8) return res.send({
            error: true, 
            password: true, 
            alert: {
                type: 'warning',
                message: 'Пароль должен состоять из 8 и более символов'
            }
        });
        if (!policy) return res.send({
            error: true, 
            alert: {
                type: 'warning',
                message: 'Подтвердите ознакомление и согласие с правилами'
            }
        });

        const user = await getUser({
            $or: [{
                name: name
            }, {
                email: email
            }]
        });

        if (user?.email == email && user?.name == name) return res.send({
            error: true, 
            email: true, 
            name: true, 
            alert: {
                type: 'warning',
                message: 'Имя и Email уже используются'
            }
        });
        if (user?.email == email) return res.send({
            error: true, 
            email: true,
            alert: {
                type: 'warning',
                message: 'Email уже используется'
            }
        });
        if (user?.name == name) return res.send({
            error: true, 
            name: true,
            alert: {
                type: 'warning',
                message: 'Имя уже используется'
            }
        });

        const verify = generate_key(20);
        const code = generate_key(6, 'number');

        return sender(name, email, 'Подтверждение регистрации', `Привет, ${name}! Код для подтверждения почты: ${code}. Спасибо!`, `<p>Привет, <b>${name}</b>! <br><br>Чтобы стать нашим пользователем, введи этот код для подтверждения почты: <b>${code}</b>.<br>Если вдруг была потеряна ссылка на регистрацию, то она тут: <a href="http://zakupki.agarix.ru/signup?key=${verify}">ссылка на подтверждение регистрации</a><br><br>Спасибо!</p>`)
        .then(async info => {
            await mongodb.db.collection('users').insertOne({
                id: await mongodb.db.collection('users').countDocuments() + 1,
                role: 1,
                email: email,
                name: name,
                sendNews: news,
                password: md5(password + salt),
                dateReg: Date.now(),
                lastAuth: 0,
                lastRequest: 0,
                sessions: [],
                activate: {
                    val: false,
                    key_email: code,
                    key_url: verify,
                    time_send: Date.now()
                },
                notices: [{
                    title: "Добро пожаловать!",
                    descript: `Привет, ${name}! Спасибо за регистрацию на сервисе, рады тебя видеть. Здесь ты можешь отслеживать интересующие закупки, получать уведомления о новых закупках, а также узнать возможных участников. Сервис имеет приятный и дружелюбный интерфейс, который можно быстро освоить. Приятного пользования!`,
                    time: Date.now(),
                    checked: false
                }],
                recovers: []
            });

            return res.render('sign', {
                type: 'fa_email',
                key: verify,
                form: 'signup',
                showEmail: false
            });
        }).catch(err => {
            console.log(err);

            return res.send({
                error: true, 
                email: true,
                alert: {
                    type: 'error',
                    message: 'Произошла ошибка при отправке письма на Email. Проверьте правильность введённого Email или попробуйте позже...'
                }
            });
        });
    } else {
        obj.recaptcha = true;
    }
    res.send(obj);
});

app.get('/forgot', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.redirect('/track');

    if (req.query.key) {
        const activater = await mongodb.db.collection('users').findOne({recovers: {$elemMatch: {key_url: req.query.key, val: false}}});
        const record = activater.recovers.find(item => item.key_url == req.query.key && !item.val);
        
        if (activater && record) {
            if (record.val) return res.render({
                type: 'auth',
                form: '',
                showEmail: false
            });

            return res.render('sign', {
                type: 'fa_email',
                key: record.key_url,
                form: 'forgot',
                showEmail: true
            });
        }
    }

    res.render('sign', {
        type: 'forgot',
        form: '',
        showEmail: false
    });
});

app.post('/forgot', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);

    if (await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}})) return res.send({redirect: '/track'});

    const type = req.body.type;
    let response  = null;
    try {
        response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${type == 'v3' ? recaptcha.key.v3 : recaptcha.key.v2}&response=${req.body.recaptcha}`, {
            method: 'POST',
            timeout: 5000
        });
    } catch(err) {
        return res.send({
            alert: {
                type: 'error',
                message: 'Сервер не смог проверить капчу. Повторите позже...'
            }
        });
    }

    if (!response) return res.send({
        alert: {
            type: 'error',
            message: 'Сервер не смог проверить капчу. Повторите позже...'
        }
    });

    const recaptchaResult = await response?.json();
    const obj = {};

    if (recaptchaResult?.success && ((type == 'v3' && recaptchaResult?.score >= 0.75) || type == 'v2')) {
        if (req.body.key) {
            const activater = await mongodb.db.collection('users').findOne({recovers: {$elemMatch: {key_url: req.body.key, val: false}}});

            if (!activater) return res.send({alert: {message: 'Ссылка на восстановление недействительна', type: 'error'}});
            const record = activater.recovers.find(item => item.key_url == req.body.key && !item.val)
            if (record.key_email != req.body.code) return res.send({alert: {message: 'Неверный код', type: 'error'}, error: true, key: true});

            record.val = true;

            await mongodb.db.collection('users').updateOne({
                id: activater.id
            }, {
                $set: {
                    recovers: activater.recovers,
                    password: record.password
                }
            });

            return res.send({alert: {message: 'Пароль восстановлен. Войдите под ним.', type: 'success'},redirect: '/auth'});
        }

        const login = req.body?.login?.trim();
        const password = req.body?.password?.trim();
        
        if (!login) return res.send({
            error: true, 
            login: true, 
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (!password) return res.send({
            error: true, 
            password: true, 
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (password.length < 8) return res.send({
            error: true, 
            password: true, 
            alert: {
                type: 'warning',
                message: 'Пароль должен состоять из 8 и более символов'
            }
        });

        const user = await getUser({
            $or: [{
                name: login
            }, {
                email: login
            }]
        });

        if (!user) return res.send({
            error: true, 
            login: true, 
            alert: {
                type: 'error',
                message: 'Пользователь не найден!'
            }
        });

        const verify = generate_key(20);
        const code = generate_key(6, 'number');

        return sender(user.name, user.email, 'Восстановление пароля', `Привет, ${user.name}! Код для восстановление пароля: ${code}. Если вы не делали запрос на восстановление пароля, проигнорируйте это письмо. Спасибо!`, `<p>Привет, <b>${user.name}</b>! <br><br>Чтобы восстановить пароль от аккаунта, введи этот код для подтверждения: <b>${code}</b>.<br><br>Если вы не делали запрос на восстановление пароля, проигнорируйте это письмо. Спасибо!</p>`)
        .then(async info => {
            await mongodb.db.collection('users').updateOne({id: user.id}, {
                $push: {
                    recovers: {
                        val: false,
                        password: md5(password + salt),
                        key_email: code,
                        key_url: verify,
                        time_send: Date.now()
                    }
                }
            });

            return res.render('sign', {
                type: 'fa_email',
                key: verify,
                form: 'forgot',
                showEmail: false
            });
        }).catch(err => {
            console.log(err);

            return res.send({
                error: true, 
                email: true,
                alert: {
                    type: 'error',
                    message: 'Произошла ошибка при отправке письма на Email. Проверьте правильность введённого Email или попробуйте позже...'
                }
            });
        });
    } else {
        obj.recaptcha = true;
    }
    res.send(obj);
});

app.get('/notices', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');

    user.notices = sortProperties(user.notices, 'time', true);
    user.notices = sortProperties(user.notices, 'checked', false);

    res.render('main', {
        type: 'notices',
        user: user
    });

    for (const item of user.notices)  {
        item.checked = true;
    }

    await mongodb.db.collection('users').updateOne({id: user.id}, { $set: { notices: user.notices }});
});

app.get('/track', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');

    const tracks = await mongodb.db.collection('tracks').find({user_id: user.id, start: true}).toArray();

    res.render('main', {
        type: 'track',
        user: user,
        tracks: tracks
    });
});

app.post('/track', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.send({redirect: '/auth'});

    if (req?.body?.info) {
        const id = Number(req?.body?.id);

        if (isNaN(id)) return res.send({alert: {message: 'Отслеживание не опознано', type: 'error'}});

        const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});

        if (!track) return res.send({alert: {message: 'Отслеживание не найдено', type: 'error'}});

        return res.send({redirect: `/track/${id}`});
    }

    if (req?.body?.stop) {
        const id = Number(req?.body?.id);

        if (isNaN(id)) return res.send({alert: {message: 'Отслеживание не опознано', type: 'error'}});

        const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});

        if (!track) return res.send({alert: {message: 'Отслеживание не найдено', type: 'error'}});

        await mongodb.db.collection('tracks').updateOne({id: id, user_id: user.id}, {$set:{start:false}});

        return res.send({redirect: `/track`});
    }

    if (req?.body?.start) {
        const id = Number(req?.body?.id);

        if (isNaN(id)) return res.send({alert: {message: 'Отслеживание не опознано', type: 'error'}});

        const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});

        if (!track) return res.send({alert: {message: 'Отслеживание не найдено', type: 'error'}});

        await mongodb.db.collection('tracks').updateOne({id: id, user_id: user.id}, {$set:{start:true}});

        return res.send({redirect: `/history`});
    }

    if (req?.body?.delete) {
        const id = Number(req?.body?.id);

        if (isNaN(id)) return res.send({alert: {message: 'Отслеживание не опознано', type: 'error'}});

        const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});

        if (!track) return res.send({alert: {message: 'Отслеживание не найдено', type: 'error'}});

        await mongodb.db.collection('tracks').deleteOne({id: id, user_id: user.id});

        return res.send({redirect: `/history`});
    }

    res.send({});
});

app.get('/track/create', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');

    res.render('main', {
        type: 'create',
        user: user
    });
});

app.get('/track/export', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});
    const id = parseInt(req.query.id);

    if (!user) return res.send({redirect: '/auth'});

    const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});
    
    if (!track) return res.send({redirect: '/track'});

    let filename = track.members.filename;

    if (!filename) {
        await exportAnalytic(track, res);
        return;
    }
    else {
        if (!await fileExists(`${__dirname}/analytics/${filename}`)) {
            await exportAnalytic(track, res);
            return;
        }
    }

    res.download(`${__dirname}/analytics/${filename}`);
});

app.post('/track/create', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.send({redirect: '/auth'});

    const type = req.body.type;
    let response  = null;
    try {
        response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${type == 'v3' ? recaptcha.key.v3 : recaptcha.key.v2}&response=${req.body.recaptcha}`, {
            method: 'POST',
            timeout: 5000
        });
    } catch(err) {
        return res.send({
            alert: {
                type: 'error',
                message: 'Сервер не смог проверить капчу. Повторите позже...'
            }
        });
    }

    if (!response) return res.send({
        alert: {
            type: 'error',
            message: 'Сервер не смог проверить капчу. Повторите позже...'
        }
    });

    const recaptchaResult = await response?.json();
    const obj = {};

    if (recaptchaResult?.success && ((type == 'v3' && recaptchaResult?.score >= 0.75) || type == 'v2')) {
        const name = req.body?.name;
        const url = req.body?.url;
        const getData = !!parseInt(req.body?.getData);
        let timer = req.body?.timer;
        const notice = {
            site: !!parseInt(req.body?.notice_site),
            email: !!parseInt(req.body?.notice_email),
            telegram: !!parseInt(req.body?.notice_telegram),
            timer: timer,
            lastItem: null,
            lastNotice: Date.now(),
            lastNoticeEmail: Date.now(),
            val: []
        };

        if (!name) return res.send({
            error: true,
            name: true,
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (!url) return res.send({
            error: true,
            url: true,
            alert: {
                type: 'warning',
                message: 'Заполните выделенное поле'
            }
        });
        if (url.search('zakupki.gov.ru/epz/order/extendedsearch/results.html') == -1) return res.send({
            error: true,
            url: true,
            alert: {
                type: 'warning',
                message: 'Неверная ссылка на поиск'
            }
        });
        if (!isNaN(parseInt(timer))) {
            timer = parseInt(timer);

            if (timer < 900) return res.send({
                error: true,
                alert: {
                    type: 'warning',
                    message: 'Время меньше 15 минут'
                }
            });
            if (timer > 86400 * 7) return res.send({
                error: true,
                alert: {
                    type: 'warning',
                    message: 'Время больше 7 дней'
                }
            });
        } else if (timer != 'moment') return res.send({
            error: true,
            alert: {
                type: 'warning',
                message: 'Время неопределено'
            }
        });

        const lastItem = await mongodb.db.collection('tracks').findOne({}, {sort:{$natural:-1}}) || {};
        const newId = lastItem?.id || 0;

        await mongodb.db.collection('tracks').insertOne({
            id: newId + 1,
            user_id: user.id,
            start: true,
            members: {
                enable: getData,
                type: 'wait_start',
                val: []
            },
            url: url,
            notice: notice,
            name: name,
            time: {
                create: Date.now(),
                change: Date.now(),
                start: null
            },
            new: 0
        });
        obj.redirect = '/track';
    } else {
        obj.recaptcha = true;
    }
    res.send(obj);
});

app.get('/track/:id', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const id = parseInt(req.params.id);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');
    if (isNaN(id)) return res.redirect('/track');

    const track = await mongodb.db.collection('tracks').findOne({id: id, user_id: user.id});
    
    if (!track) return res.redirect('/track');

    res.render('main', {
        type: 'info',
        user: user,
        track: track
    });
});

app.get('/history', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');

    const tracks = await mongodb.db.collection('tracks').find({user_id: user.id, start: false}).toArray();

    res.render('main', {
        type: 'history',
        user: user,
        tracks: tracks
    });
});

app.get('/settings', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.redirect('/auth');

    res.render('main', {
        type: 'settings',
        user: user
    });
});


app.post('/settings', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    const user = await getUser({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}});

    if (!user) return res.send({redirect: '/auth'});

    const name = req.body?.name?.trim();
    const old_pass = req.body?.old_pass?.trim();
    const new_pass = req.body?.new_pass?.trim();
    const news = req.body.news;
    const upd = {
        $set: {
            name: name,
            sendNews: news
        }
    };

    if (name.length < 4) return res.send({
        error: true, 
        name: true, 
        alert: {
            type: 'warning',
            message: 'Слишком короткое имя'
        }
    });

    if (name) {
        const username = await getUser({name: name});

        if (username && username.id != user.id) return res.send({
            error: true,
            name: true,
            alert: {
                type: 'warning',
                message: 'Имя занято другим пользователем'
            }
        });
    }

    if (old_pass && new_pass) {
        if (md5(old_pass + salt) != user.password) return res.send({
            error: true,
            old_pass: true,
            alert: {
                type: 'error',
                message: 'Неверный старый пароль!'
            }
        });

        if (new_pass.length < 8) return res.send({
            error: true, 
            new_pass: true, 
            alert: {
                type: 'warning',
                message: 'Новый пароль должен состоять из 8 и более символов'
            }
        });

        upd.$set.password = md5(new_pass + salt);
    }

    await mongodb.db.collection('users').updateOne({id: user.id}, upd);

    return res.send({
        alert: {
            type: 'success',
            message: 'Настройки сохранены'
        }
    });
});

app.post('/logout', urlencodedParser, async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    await mongodb.db.collection('users').updateMany({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}}, { $pull: {sessions: {id: sessionID, agent: req.headers['user-agent']} }});
    
    res.send({redirect: '/auth'});
});

app.get('/logout', async(req, res) => {
    if (!mongodb.db) return res.render('error', {
        type: 500
    });

    const sessionID = setSessionID(req, res);
    await mongodb.db.collection('users').updateMany({sessions: {$elemMatch: {id: sessionID, agent: req.headers['user-agent']}}}, { $pull: {sessions: {id: sessionID, agent: req.headers['user-agent']} }});
    
    res.redirect('/auth');
});

app.get('/', async(req, res) => {
    res.redirect('/auth');
});

app.use((req, res, next) => {
    res.render('error', {
        type: 404
    });
});

io.on('connection', function(socket) {
    //console.log('A user connected');
 
    //Whenever someone disconnects this piece of code executed
    socket.on('disconnect', function () {
       //console.log('A user disconnected');
    });
 });

 http.listen(80);

 async function sender(name, to, subject, text, html) {
     return await transport.sendMail({
         from: '"ZakupkiParser" <zakupki.pars@gmail.com>',
         to: `"${name}" <${to}>`,
         subject: subject,
         text: text,
         html: html
     });
 }

const fileExists = async path => !!(await fs.promises.stat(path).catch(e => false));

function generate_key(len, type) {
    let key = '';
    const possible = type == 'number' ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < len; i++) key += possible.charAt(Math.floor(Math.random() * possible.length));

    return key;
}

function setSessionID(req, res) {
    if (req.session.sid) return req.session.sid;
    //console.log(req.connection.remoteAddress)
    //console.log(req.ip)
    //console.log(req.ips)
    //console.log(req.ipInfo)

    const sessionKey = md5(req.ipInfo.ip + req.headers['user-agent'] + salt);
    const cookies = (req.headers.cookie || '').split('; ').map(item => { return {name: item.split('=')[0], val: item.split('=')[1]}});
    const sessionID = cookies.find(item => item.name == 'sessionID') || {};
    
    if (sessionKey != sessionID.val) res.cookie('sessionID', sessionKey, {maxAge: 864e5*365});

    req.session.sid = sessionKey;

    return sessionKey;
}

async function getUser(obj) {
    const user = await mongodb.db.collection('users').findOne(obj);

    return user;
}

function sortProperties(obj, sortedBy, reverse) {
    sortedBy = sortedBy || 1;
    reverse = reverse || false;

    const reversed = (reverse) ? -1 : 1;

    const sortable = [];
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            sortable.push([key, obj[key]]);
        }
    }

    sortable.sort(function (a, b) {
        return reversed * (a[1][sortedBy] - b[1][sortedBy]);
    });

    const new_arr = [];

    for (const item of sortable) {
        new_arr.push(item[1]);
    }
    return new_arr;
}

setInterval(async () => {
    const tracks = await mongodb.db.collection('tracks').find({start: true, 'members.enable': true}).toArray();

    for (const track of tracks) {
        const tracked = tracksOnly.find(item => item == track.id);

        if (track.members.type == 'wait_start') {
            await mongodb.db.collection('tracks').updateOne({id: track.id}, {
                $set: {
                    'members.type': 'started',
                    'time.change': Date.now()
                }
            });

            trackLink(track);
            tracksOnly.push(track.id);
        } else if (track.members.type == 'started' && !tracked) {
            trackLink(track);
            tracksOnly.push(track.id);
        }
    }
}, 60 * 1000);

setInterval(async () => {
    const tracks = await mongodb.db.collection('tracks').find({start: true}).toArray();

    for (const track of tracks) {
        const noticed = {
            valEmail: [],
            valSite: []
        };

        for (const notice of track.notice.val) {
            let timer = Number(track.notice.timer);

            if (isNaN(timer)) timer = 0;
            
            if (track.notice.lastNotice + (timer * 1000) <= Date.now() && track.notice.site && !notice.site) {
                notice.site = true;
                const dated = new Date(notice.pubDate);
            
                noticed.valSite.push({
                    title: `<a href="${notice.link}" style="color: #7289da !important;">${notice.title}</a>`,
                    descript: `
                    <div>Отслеживание: ${track.name}</div>
                    <div>Заказчик: ${notice.customer}</div>
                    <div>Описание: ${notice.desc}</div>
                    <div>Начальная цена: ${parseInt(notice.price).toFixed(0).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1 ")} ₽</div>
                    <div>Дата публикации: ${dated.toLocaleDateString()} ${dated.toLocaleTimeString()}</div>`,
                    time: Date.now(),
                    checked: false
                });
            }

            if (track.notice.lastNoticeEmail + (timer * 1000) <= Date.now() && track.notice.lastNoticeEmail + (1800 * 1000) <= Date.now() && track.notice.email && !notice.email) {
                notice.email = true;
                const dated = new Date(notice.pubDate);

                noticed.valEmail.push({
                    title: notice.title,
                    link: notice.link,
                    customer: notice.customer,
                    desc: notice.desc,
                    price: parseInt(notice.price).toFixed(0).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1 "),
                    date: dated.toLocaleDateString() + ' ' + dated.toLocaleTimeString()
                });
            }
        }

        if (noticed.valSite.length) {
            await mongodb.db.collection('users').updateOne({id: track.user_id}, {$push: {
                'notices': {$each: noticed.valSite}
            }});
            await mongodb.db.collection('tracks').updateOne({id: track.id}, {$set: {'notice.lastNotice': Date.now()}});
        }
        if (noticed.valEmail.length) {
            let html = `<div style="background: rgb(34, 43, 54);padding: 20px;color: #fff;border-radius: 10px;">
            <div style="margin-bottom: 20px;font-weight: 600;text-align: center;font-size: 16pt;">Найдено ${noticed.valEmail.length} новых закупок!</div>
            <div style="color: #898989;margin-bottom: 10px;">По вашему отслеживанию "${track.name}" найдены новые закупки. С их списком можно ознакомиться ниже.</div>
            <div class="items" style="max-height: 600px;overflow-y: auto;">`;

            for (const item of noticed.valEmail) {
                html += `<div class="item" style="background: rgb(27, 35, 45);border-radius: 10px;padding: 20px;color: #919eab;line-height: 20px;margin-bottom: 15px;">
                <div style="color: #fff;margin-bottom: 10px;font-weight: 600;">
                    <a href="${item.link}" style="color: #7289da !important;">${item.title}</a>
                </div>
                <div>Заказчик: ${item.customer}</div>
                <div>Описание: ${item.desc}</div>
                <div>Начальная цена: ${item.price} ₽</div>
                <div>Дата публикации: ${item.date}</div>
            </div>`;
            }
            html += `</div>
            </div>`;

            const user = await getUser({id: track.user_id});

            sender(user.name, user.email, 'Новые закупки', `Найдено ${noticed.valEmail.length} новых закупок! В этом письме находится вся информация о них.`, html);
            await mongodb.db.collection('tracks').updateOne({id: track.id}, {$set: {'notice.lastNoticeEmail': Date.now()}});
        }
        track.notice.val = track.notice.val.filter(item => !(item.email && item.site));

        await mongodb.db.collection('tracks').updateOne({id: track.id}, {$set: {'notice.val': track.notice.val}});

        noticeLink(track);
    }
}, 60 * 1000);

async function noticeLink(track) {
    let href = new URL(track.url.replace('results.html', 'rss.html'));

    href.searchParams.delete('pc');
    href.searchParams.delete('ca');
    href.searchParams.delete('pa');
    href.searchParams.set('sortBy', 'PUBLISH_DATE');
    href.searchParams.set('af', 'on');

    let feed = await parser.parseURL(href.toString());

    if (!feed.items.length) return;
    if (!track.notice.lastItem) return await mongodb.db.collection('tracks').updateOne({id: track.id}, {
        $set: {
            'notice.lastItem': feed.items[0].title.split('№')[1],
            'time.change': Date.now()
        }
    });

    const user = await getUser({id: track.user_id});
    const arr = [];

    for (const item of feed.items) {
        const id = item.title.split('№')[1];

        if (id == track.notice.lastItem) break;

        if (user.notices.find(itemz => itemz.title.search(item.title) != -1)) continue;

        const contentSnippet = {};

        for (const str of item.contentSnippet.split('\n')) {
            const dels = str.split(':');
            contentSnippet[dels[0]] = dels[1]?.trim();
        }

        arr.push({
            title: item.title,
            customer: contentSnippet['Наименование Заказчика'],
            desc: contentSnippet['Наименование объекта закупки'],
            price: contentSnippet['Начальная цена контракта'].split(' ')[0],
            link: `https://zakupki.gov.ru${item.link}`,
            pubDate: new Date(item.pubDate).getTime(),
            timeAdd: Date.now(),
            email: false,
            site: false
        });
    }
    
    const upd = {
        $set: {
            'notice.lastItem': feed.items[0].title.split('№')[1],
            'time.change': Date.now()
        }
    }
    if (arr.length && arr.length < feed.items.length) {
        upd.$push = {
            'notice.val': {$each: arr}
        };
        upd.$inc = {
            new: arr.length
        };
    }
    await mongodb.db.collection('tracks').updateOne({id: track.id}, upd);
}

async function trackLink(track) {
    let href = new URL(track.url);
    href.searchParams.set('sortBy', 'PUBLISH_DATE');
    href.searchParams.delete('af');
    href.searchParams.delete('ca');
    href.searchParams.delete('pa');
    href.searchParams.delete('fz94');
    href.searchParams.delete('ppRf615');
    href.searchParams.delete('fz223');
    href.searchParams.set('pc', 'on');
    href.searchParams.set('fz44', 'on');
    href.searchParams.set('recordsPerPage', '_500');

    const res = await fetch(href.toString());
    const html = await res.text();
    const dom = new JSDOM(html);
    const nums = [];
    const links = dom.window.document?.querySelectorAll('#quickSearchForm_header > section.content.content-search-registry-block > div > div > div.col-9.search-results > div.search-registry-entrys-block > div');
    const user = await getUser({id: track.user_id});

    for (const item of links) {
        const link = item.querySelector('div > div.col-8.pr-0.mr-21px > div.registry-entry__header > div.d-flex.registry-entry__header-mid.align-items-center > div.registry-entry__header-mid__number > a').getAttribute('href');

        if (link) nums.push(link.split('regNumber=')[1]);
    }

    const arr = [];
    
    for (const item of nums) {
        try {
            const res1 = await fetch(encodeURI(`https://zakupki.gov.ru/epz/order/notice/ea44/view/supplier-results.html?regNumber=${item}`), {timeout: 10000}).then().catch(err => {});
            const html1 = await res1.text();
            const dom1 = new JSDOM(html1 || '');
            let nextShipper = false;
            let nth = 1;
            let shipper = dom1.window.document.querySelector("table.tableBlock:nth-child(2) > tbody > tr:nth-child(1) > td:nth-child(1)")?.textContent?.trim();
            
            if (!shipper) {
                nextShipper = true;
                shipper = dom1.window.document.querySelector("table.tableBlock:nth-child(2) > tbody > tr:nth-child(2) > td:nth-child(1)")?.textContent?.trim();
            }

            if (!isNaN(Number(shipper))) {
                nth++;

                if (!nextShipper) shipper = dom1.window.document.querySelector(`table.tableBlock:nth-child(2) > tbody > tr:nth-child(1) > td:nth-child(${nth})`)?.textContent?.trim();
                else shipper = dom1.window.document.querySelector(`table.tableBlock:nth-child(2) > tbody > tr:nth-child(2) > td:nth-child(${nth})`)?.textContent?.trim();

            }

            if (shipper) {
                arr.push({
                    shipper: shipper,
                    customer: dom1.window.document.querySelector("table.tableBlock:nth-child(1) > tbody > tr:nth-child(1) > td:nth-child(1)")?.textContent?.trim() || '',
                    dateApplication: dom1.window.document.querySelector(".date > .row > .cardMainInfo__section > .cardMainInfo__content")?.textContent?.trim(),
                    sum: dom1.window.document.querySelector(".price > span.cost")?.textContent?.trim() || '0'
                })
            }
        } catch(err) {
            continue;
        }
    }

    await mongodb.db.collection('tracks').updateOne({id: track.id}, {
        $set: {
            'members.type': 'end',
            'members.enable': false,
            'members.val': arr,
            'time.change': Date.now()
        }
    });
    await mongodb.db.collection('users').updateOne({id: track.user_id}, {
        $push: {
            notices: {
                title: "Аналитика собрана!",
                descript: `Для отслеживания под именем "${track.name}" была собрана аналитика. Её результат вы можете скачать, нажав кнопку "Подробнее" на нужном отслеживании и нажать "Экспорт в Excel".`,
                time: Date.now(),
                checked: false
            }
        }
    });
    return sender(user.name, user.email, 'Аналитика собрана', `Аналитика по отслеживанию "${track.name}" успешно собрана! Вы можете её скачать и посмотреть в Excel.`, `Аналитика по отслеживанию "${track.name}" успешно собрана! Вы можете её скачать по <a href="http://zakupki.agarix.ru/track/${track.id}">ссылке</a>, нажав кнопку "Экспорт в Excel" и посмотреть в результаты в Excel.`)
}

async function exportAnalytic(track, res) {
    const members = [];
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Анализ участников');
    const styleBold = workbook.createStyle({
        alignment: {
            horizontal: ['center'],
        },
        font: {
            color: '#000000',
            size: 12,
            bold: true,
        }
    });
    const style = workbook.createStyle({
        alignment: {
            horizontal: ['left'],
        },
        font: {
            color: '#000000',
            size: 12
        }
    });
    const styleRub = workbook.createStyle({
        alignment: {
            horizontal: ['right'],
        },
        font: {
            color: '#000000',
            size: 12
        },
        numberFormat: '#,##0.00 ₽; (#,##0.00 ₽); -'
    });
    let row = 2;

    worksheet.cell(1, 1).string('Название участника').style(styleBold);
    worksheet.cell(1, 2).string('Количество участий').style(styleBold);
    worksheet.cell(1, 3).string('Средняя цена контракта').style(styleBold);
    worksheet.cell(1, 4).string('Последняя дата активности').style(styleBold);
    worksheet.cell(1, 5).string('Востребованный заказчик').style(styleBold);
    worksheet.cell(1, 6).string('Количество заказов у этого заказчика').style(styleBold);
    
    worksheet.column(1).setWidth(65);
    worksheet.column(2).setWidth(20);
    worksheet.column(3).setWidth(24);
    worksheet.column(4).setWidth(25);
    worksheet.column(5).setWidth(75);
    worksheet.column(6).setWidth(35);

    for (const member of track.members.val) {
        if (members.find(item => item == member.shipper)) continue;

        let price = 0;
        const allMembers = track.members.val.filter(item => item.shipper == member.shipper);
        let date = 0;
        const arrCustomers = [];

        for (const item of allMembers) {
            price += parseInt(String(item.sum).trim().replace(' ','').replace(' ','').replace(',','.').replace('₽',''));

            const dated = item.dateApplication.split('.');
            date = Math.max(date, new Date(`${dated[1]}.${dated[0]}.${dated[2]}`).getTime());

            const itemArr = arrCustomers.find(itemm => itemm.name == item.customer);

            if (!itemArr) arrCustomers.push({name: item.customer, nums: 1});
            else itemArr.nums += 1;
        }

        arrCustomers.sort((a,b) => {
            return b.nums - a.nums;
        });

        worksheet.cell(row, 1).string(member.shipper).style(style);
        worksheet.cell(row, 2).number(allMembers.length).style(style);
        worksheet.cell(row, 3).number(price / allMembers.length).style(styleRub);
        worksheet.cell(row, 4).string(new Date(date).toLocaleDateString()).style(style);
        worksheet.cell(row, 5).string(arrCustomers[0].name).style(style);
        worksheet.cell(row, 6).number(arrCustomers[0].nums).style(style);
        
        members.push(member.shipper);
        
        row++;
    }

    const filename = `analytics-${track.id}.xlsx`;

    await workbook.write(`${filename}`, res);
    await workbook.write(`analytics/${filename}`);

    await mongodb.db.collection('tracks').updateOne({id: track.id}, {
        $set: {
            'members.filename': filename
        }
    });
}
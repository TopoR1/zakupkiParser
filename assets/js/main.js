const recaptcha = {
    key: {
        v2: '', // ключ рекапчи для сайта версии 2
        v3: '' // ключ рекапчи для сайта версии 3
    },
    load: false,
    back: false,
    element: null
};
let typeForm = null;
let mainEvents = false;
const items = ['track', 'notices', 'history', 'settings', 'create', 'info'];
const authItems = ['auth', 'signup', 'forgot']

function alert_message(message, type = 'success', time = 5000) {
    const obj = {
        title: message,
        //message: 'Successfully inserted record!',
        position: 'topRight',
        transitionIn: 'bounceInLeft',
        transitionOut: 'fadeOutRight',
        timeout: time
    };

    switch(type) {
        case 'success':
            iziToast.success(obj);
            break;
        case 'error':
            iziToast.error(obj);
            break;
        case 'warning':
            iziToast.warning(obj);
            break;
        case 'info':
            iziToast.info(obj);
            break;
    }
}

function grecaptchaLoaded() {
    recaptcha.load = true;
    
    loaderButton('', false);
}

function init(type) {
    typeForm = type || $('.sign:visible')?.attr('class')?.split(' ')[1] || $('#content .content:visible')?.attr('class')?.split(' ')[1];
    events();
    correctShow();
    if (!recaptcha.load) loaderButton();
}

function events() {
    $('.sign .actions > div').on('click', async function () {
        const path = $(this).attr('class');

        if (path == 'back') return $('.sign.fa_email').fadeOut(333, () => $($('.sign')[0]).fadeIn(333));

        $.get(`/${path}`).then(function (data) {
            const parser = new DOMParser();
            const dom = parser.parseFromString(data, "text/html");

            $('#content').replaceWith(dom.querySelector('#content'));
            setLocation(path);
            init();
        });
    });
    $('.sign button').on('click', () => sign().then().catch(e=>{loaderButton(typeForm, false);}));
    $('.sign.fa_email .actions .send').on('click', () => {
        //$('.fa_email').fadeOut(333, () => $('.sign')[0].fadeIn(333));
    });
    if ($('.panels').length && !mainEvents) {
        mainEvents = true;
        
        $('.panels > .top button.logout').on('click', async() => {
            loaderButton('logout');
            await logout();
            loaderButton('logout', false);
        });
        $('.panels > .right > .items > .item').on('click', panelRight);
        $('.panels > .right > .menu').on('click', () => $('.panels > .right').toggleClass('mini'));
    } else if (!$('.panels').length) mainEvents = false;
    $('.content > .tracks > .item.create').on('click', tracks);
    $('.content > .tracks > .item > .btns > button').on('click', tracks);
    $('.content > .info button').on('click', tracks);
    $('.content > .history button').on('click', tracks);
    $('.content > .create > button.create').on('click', async() => {
        $('.create .topor-input').removeClass('err');
        loaderButton('create');
        await createTrack();
        loaderButton('create', false);
    });
    $('.content > .settings button.save').on('click', async() => {
        $('.settings .topor-input').removeClass('err');
        loaderButton('save');
        await setSettings();
        loaderButton('save', false);
    });
}

async function setSettings() {
    const name = $('.settings .name').val().trim();
    const old_pass = $('.settings .passwords .old_pass').val().trim();
    const new_pass = $('.settings .passwords .new_pass').val().trim();
    const news = $('#news').is(':checked');

    const response = await $.ajax({
        url: `/settings`,
        method: 'POST',
        cache: false,
        data: {
            name: name,
            old_pass: old_pass,
            new_pass: new_pass,
            news: news
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.error) {
        if (response.name) $('.settings .name').parent().addClass('err');
        if (response.old_pass) $('.settings .passwords .old').addClass('err');
        if (response.new_pass) $('.settings .passwords .new').addClass('err');

        swingButton('save');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawPage(response.redirect);
}

async function sign(val) {
    $('.sign .topor-input').removeClass('err');

    if (!recaptcha.load) return alert_message('Подождите... reCaptcha ещё не загрузилась', 'info');
    if (!typeForm) return alert_message('Ошибка в определении типа формы', 'error');

    loaderButton(typeForm);

    const token = val || await grecaptcha.execute(recaptcha.key.v3, {action: typeForm});
    const type = val && 'v2' || 'v3';

    switch(typeForm) {
        case 'auth':
            await auth(token, type);
            break;
        case 'signup':
            await signup(token, type);
            break;
        case 'fa_email':
            await fa_email(token, type);
            break;
        case 'forgot':
            await forgot(token, type);
            break;
    }

    loaderButton(typeForm, false);
}

async function auth(token, type) {
    const login = $('.sign.auth .login').val().trim();
    const password = $('.sign.auth .password').val().trim();

    if (!login || !password) {
        !login && $('.sign.auth .login').parent().addClass('err');
        !password && $('.sign.auth .password').parent().addClass('err');

        swingButton('auth');
        
        return alert_message(!login && !password ? 'Заполните выделенные поля' : 'Заполните выделенное поле', 'warning');
    }

    const response = await $.ajax({
        url: '/auth',
        method: 'POST',
        cache: false,
        dataType: 'json',
        data: {
            recaptcha: token,
            type: type,
            login: login,
            password:  password
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.recaptcha) {
        checkRecaptchaSign(response.recaptcha);
        recaptcha.back = true;
    } else if (recaptcha.back) {
        recaptcha.back = false;
        $('.recaptcha').fadeOut(333, () => $('.sign').fadeIn(333));
        correctShow();
    }
    if (response.error) {
        if (response.login) $('.sign.auth .login').parent().addClass('err');
        if (response.password) $('.sign.auth .password').parent().addClass('err');

        swingButton('auth');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) {
        recaptcha.element = null;
        drawPage(response.redirect);
    }
}

async function signup(token, type) {
    const name = $('.sign.signup .name').val().trim();
    const email = $('.sign.signup .email').val().trim();
    const password = $('.sign.signup .password').val().trim();
    const policy = $('.sign.signup #policy').is(':checked');
    const news = $('.sign.signup #news').is(':checked');
    const pattern = /^([a-z0-9_\.-])+@[a-z0-9-]+\.([a-z]{2,4}\.)?[a-z]{2,4}$/i;

    if (!name || !email || !password) {
        let items = 0;
        
        !name && $('.sign.signup .name').parent().addClass('err') && items++;
        !email && $('.sign.signup .email').parent().addClass('err') && items++;
        !password && $('.sign.signup .password').parent().addClass('err') && items++;

        swingButton('signup');
        
        return alert_message(items > 1 ? 'Заполните выделенные поля' : 'Заполните выделенное поле', 'warning');
    }

    if (!pattern.test(email)) {
        swingButton('signup');
        
        return alert_message('Проверьте правильность введённого Email', 'warning');
    }

    if (!policy) {
        swingButton('signup');
        
        return alert_message('Подтвердите ознакомление и согласие с правилами', 'warning');
    }

    const response = await $.ajax({
        url: '/signup',
        method: 'POST',
        cache: false,
        data: {
            recaptcha: token,
            type: type,
            name: name,
            email: email,
            password: password,
            policy: policy,
            news: news
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);

    if (typeof(response) != 'object') {
        const parser = new DOMParser();
        const dom = parser.parseFromString(response, "text/html");
        const element = await dom.querySelector('#content .fa_email');

        if (!element) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен. (2)', 'error', 8000);

        $('#content').append(element);
        setLocation(`signup?key=${element.getAttribute('key')}`);
        $('.sign.signup, .recaptcha').fadeOut(333, () => $('.sign.fa_email').fadeIn(333));
        init('fa_email');
    }
    if (response.recaptcha) {
        checkRecaptchaSign(response.recaptcha);
        recaptcha.back = true;
    } else if (recaptcha.back) {
        recaptcha.back = false;
        if (typeof(response) == 'object') $('.recaptcha').fadeOut(333, () => $('.sign.signup').fadeIn(333));
        correctShow();
    }
    if (response.error) {
        if (response.name) $('.sign.signup .name').parent().addClass('err');
        if (response.email) $('.sign.signup .email').parent().addClass('err');
        if (response.password) $('.sign.signup .password').parent().addClass('err');

        swingButton('signup');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) {
        recaptcha.element = null;
        drawPage(response.redirect);
    }
}

async function forgot(token, type) {
    const login = $('.forgot input.login').val().trim();
    const password = $('.forgot input.password').val().trim();
    
    if (!login || !password) {
        !login && $('.forgot input.login').parent().addClass('err');
        !password && $('.forgot input.password').parent().addClass('err');

        swingButton('forgot');
        
        return alert_message(!login && !password ? 'Заполните выделенные поля' : 'Заполните выделенное поле', 'warning');
    }

    const response = await $.ajax({
        url: '/forgot',
        method: 'POST',
        cache: false,
        data: {
            recaptcha: token,
            type: type,
            login: login,
            password: password,
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);

    if (typeof(response) != 'object') {
        const parser = new DOMParser();
        const dom = parser.parseFromString(response, "text/html");
        const element = await dom.querySelector('#content .fa_email');

        if (!element) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен. (2)', 'error', 8000);

        $('#content').append(element);
        setLocation(`forgot?key=${element.getAttribute('key')}`);
        $('.sign, .recaptcha').fadeOut(333, () => $('.sign.fa_email').fadeIn(333));
        init('fa_email');
    }
    if (response.recaptcha) {
        checkRecaptchaSign(response.recaptcha);
        recaptcha.back = true;
    } else if (recaptcha.back) {
        recaptcha.back = false;
        if (typeof(response) == 'object') $('.recaptcha').fadeOut(333, () => $('.sign').fadeIn(333));
        correctShow();
    }
    if (response.error) {
        if (response.login) $('.forgot input.login').parent().addClass('err');
        if (response.password) $('.forgot input.password').parent().addClass('err');

        swingButton('forgot');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) {
        recaptcha.element = null;
        drawPage(response.redirect);
    }
}

async function fa_email(token, type) {
    const code = $('.sign.fa_email .key').val().trim();
    const key = $('.sign.fa_email').attr('key');
    const url = $('.sign.fa_email').attr('type');

    if (!code) {
        $('.sign.fa_email .key').parent().addClass('err');

        swingButton('fa_email');
        
        return alert_message('Заполните выделенное поле', 'warning');
    }

    const response = await $.ajax({
        url: `/${url}`,
        method: 'POST',
        cache: false,
        data: {
            recaptcha: token,
            type: type,
            code: code,
            key: key
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);

    if (response.recaptcha) {
        checkRecaptchaSign(response.recaptcha);
        recaptcha.back = true;
    } else if (recaptcha.back) {
        recaptcha.back = false;
        $('.recaptcha').fadeOut(333, () => $('.sign.fa_email').fadeIn(333));
        correctShow();
    }
    if (response.error) {
        if (response.key) $('.sign.fa_email .key').parent().addClass('err');

        swingButton('fa_email');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawPage(response.redirect);
}

async function logout() {
    const response = await $.ajax({
        url: `/logout`,
        method: 'POST',
        cache: false,
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.redirect) {
        recaptcha.element = null;
        drawPage(response.redirect);
    }
}

function panelRight() {
    const type = $(this).children(':first').attr('class');

    if ($(this).attr('class')?.split(' ')[1] == 'active') return;

    $('.item').removeClass('active');
    $(`.item > .${type}`).parent().addClass('active');

    switch(type) {
        case 'notices':
            drawItem('/notices');
            break;
        case 'track':
            drawItem('/track');
            break;
        case 'history':
            drawItem('/history');
            break;
        case 'settings':
            drawItem('/settings');
            break;
    }
}

function tracks() {
    const type = $(this).attr('class')?.split(' ')[1];
    
    switch(type) {
        case 'create':
            drawItem('/track/create');
            break;
        case 'info':
            infoTrack(this);
            break;
        case 'stop':
            stopTrack(this);
            break;
        case 'history':
            drawItem('/history');
            break;
        case 'settings':
            drawItem('/settings');
            break;
        case 'export':
            loaderButton('export');
            exportTrack(this);
            loaderButton('export', false);
            break;
        case 'start':
            startTrack(this);
            break;
        case 'delete':
            deleteTrack(this);
            break;
    }
}

async function createTrack(val) {
    if (!recaptcha.load) return alert_message('Подождите... reCaptcha ещё не загрузилась', 'info');
    if (!typeForm) return alert_message('Ошибка в определении типа формы', 'error');

    const token = val || await grecaptcha.execute(recaptcha.key.v3, {action: typeForm});
    const type = val && 'v2' || 'v3';
    const name = $('#content > .content > .create .name').val().trim();
    const url = $('#content > .content > .create .url').val().trim();
    const getData = $('#content > .content > .create input[type=radio]:checked').attr('id') == 'getData' && 1 || 0;
    const notice = {
        site: $('#content > .content > .create #notice_site').is(':checked') && 1 || 0,
        email: $('#content > .content > .create #notice_email').is(':checked') && 1 || 0,
        telegram: $('#content > .content > .create #notice_tgm').is(':checked') && 1 || 0
    };
    const timer = $('#content > .content > .create #timeNotice').val();

    if (!name) {
        $('#content > .content > .create .name').parent().addClass('err');

        swingButton('create');
        
        return alert_message('Заполните выделенное поле', 'warning');
    }

    if (!url) {
        $('#content > .content > .create .url').parent().addClass('err');

        swingButton('create');
        
        return alert_message('Заполните выделенное поле', 'warning');
    }

    if (url.search('zakupki.gov.ru/epz/order/extendedsearch/results.html') == -1) {
        $('#content > .content > .create .url').parent().addClass('err');

        swingButton('create');
        
        return alert_message('Неверная ссылка на поиск', 'warning');
    }

    const response = await $.ajax({
        url: `/track/create`,
        method: 'POST',
        cache: false,
        data: {
            recaptcha: token,
            type: type,
            name: name,
            url: url,
            getData: getData,
            notice_site: notice.site,
            notice_email: notice.email,
            notice_telegram: notice.telegram,
            timer: timer
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);

    if (response.recaptcha) {
        checkRecaptchaTrack(response.recaptcha);
        recaptcha.back = true;
    } else if (recaptcha.back) {
        recaptcha.back = false;
        $('.recaptcha').fadeOut(333, () => $('.create').fadeIn(333));
    }
    if (response.error) {
        if (response.name) $('#content > .content > .create .name').parent().addClass('err');
        if (response.url) $('#content > .content > .create .url').parent().addClass('err');

        swingButton('fa_email');
    }
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawItem(response.redirect);
}

async function infoTrack(btn) {
    const id = Number($(btn)?.parent()?.parent()?.attr('class')?.split(' ')[1]);

    if (isNaN(id)) return alert_message('Отслеживание не опознано', 'error');

    const response = await $.ajax({
        url: `/track`,
        method: 'POST',
        cache: false,
        data: {
            info: true,
            id: id
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawItem(response.redirect);
}

async function stopTrack(btn) {
    const id = Number($(btn)?.parent()?.parent()?.attr('class')?.split(' ')[1]);

    if (isNaN(id)) return alert_message('Отслеживание не опознано', 'error');

    const response = await $.ajax({
        url: `/track`,
        method: 'POST',
        cache: false,
        data: {
            stop: true,
            id: id
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawItem(response.redirect);
}

async function startTrack(btn) {
    const id = Number($(btn)?.parent()?.parent()?.attr('class')?.split(' ')[1]);

    if (isNaN(id)) return alert_message('Отслеживание не опознано', 'error');

    const response = await $.ajax({
        url: `/track`,
        method: 'POST',
        cache: false,
        data: {
            start: true,
            id: id
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawItem(response.redirect);
}

async function deleteTrack(btn) {
    const id = Number($(btn)?.parent()?.parent()?.attr('class')?.split(' ')[1]);

    if (isNaN(id)) return alert_message('Отслеживание не опознано', 'error');

    const response = await $.ajax({
        url: `/track`,
        method: 'POST',
        cache: false,
        data: {
            delete: true,
            id: id
        },
        timeout: 10000
    }).catch(err => console.log(err));

    if (!response) return alert_message('Сервер не отвечает. Возможно, потерян доступ к сети или сервер временно недоступен.', 'error', 8000);
    if (response.alert) alert_message(response.alert.message, response.alert.type);
    if (response.redirect) drawItem(response.redirect);
}

async function exportTrack(btn) {
    const id = Number($(btn).attr('id'));

    window.location.href = `/track/export?id=${id}`;
}

function loaderButton(tag = '', add = true) {
    if (tag) tag = `.${tag}`;

    if (add) {
        $(`button${tag}`).append(`
        <span class="spinner button">
            <span class="ellipsis">
                <span class="item"></span>
                <span class="item"></span>
                <span class="item"></span>
            </span>
        </span>`);
        $(`button${tag} > span.text`).css('visibility', 'hidden');
        $(`button${tag}`).prop('disabled', true);
    } else {
        $(`button${tag} .spinner`).remove();
        $(`button${tag} > span.text`).css('visibility', '');
        $(`button${tag}`).prop('disabled', false);
    }
}

function checkRecaptchaSign(data) {
    $('.sign').fadeOut(333, () => $('.recaptcha').fadeIn(333), correctShow(1));

    if (recaptcha.element == null || $('#recaptcha').html() == '') {
        recaptcha.element = grecaptcha.render('recaptcha', {
            'sitekey': recaptcha.key.v2,
            'theme': 'dark',
            'callback': sign
        });
    } else {
        grecaptcha.reset(recaptcha.element);
    }
}

function checkRecaptchaTrack(data) {
    $('.create').fadeOut(333, () => $('.recaptcha').fadeIn(333));

    if (recaptcha.element == null ||  $('#recaptcha').html() == '') {
        recaptcha.element = grecaptcha.render('recaptcha', {
            'sitekey': recaptcha.key.v2,
            'theme': 'dark',
            'callback': createTrack
        });
    } else {
        grecaptcha.reset(recaptcha.element);
    }
}

function setLocation(curLoc) {
    try {
        history.pushState(null, null, curLoc);
        return;
    } catch(e) {}
    location.hash = '#' + curLoc;
}

function swingButton(tag) {
    $(`button.${tag}`).addClass('swing');
    setTimeout(() => {$(`button.${tag}`).removeClass('swing');}, 1000)
}

function drawItem(url, change = true) {
    $('#content > .content').html(`
    <span class="spinner content">
        <span class="ellipsis">
            <span class="item"></span>
            <span class="item"></span>
            <span class="item"></span>
        </span>
    </span>`);

    if ($('.recaptcha').is(':visible')) $('.recaptcha').fadeOut(333);

    $.get(url).then(function (data) {
        const parser = new DOMParser();
        const dom = parser.parseFromString(data, "text/html");

        $(dom).ready(() => {
            $('#content > .content').replaceWith(dom.querySelector('#content > .content'));
            init();
        });
        
        if (change) setLocation(url);
    });
}

function drawPage(url) {
    mainEvents = false;

    $('#content').html(`
    <span class="spinner form">
        <span class="ellipsis">
            <span class="item"></span>
            <span class="item"></span>
            <span class="item"></span>
        </span>
    </span>`);

    if ($('.recaptcha').is(':visible')) $('.recaptcha').fadeOut(333);

    $.get(url).then(function (data) {
        const parser = new DOMParser();
        const dom = parser.parseFromString(data, "text/html");

        $(dom).ready(() => {
            $('#content').replaceWith(dom.querySelector('#content'));
            init();
        });
        
        setLocation(url);
    });
}

window.onload = () => init();

(function() {
    let location = window.location.href.split('/');
    let old_location = location;
    let path = location[location.length - 1];
    
    if (!isNaN(Number(path))) 
        path = `/${location[location.length - 2]}/${location[location.length - 1]}`;

    setInterval(() => {
        location = window.location.href.split('/');
        let realPath = location[location.length - 1];
        let checkAuth = true;
        let realForm = items.find(item => item == realPath) || authItems.find(item => item == realPath);

        if (!isNaN(Number(realPath))) {
            if (!realForm) {
                realForm = 'info';
                realPath = `/${location[location.length - 2]}/${location[location.length - 1]}`;
            }
            checkAuth = false;
        } else if (!isNaN(Number(path.split('/')[2]))) {
            if (!realForm) realForm = 'info';

            checkAuth = false;
        }

        if (path != realPath && realForm != typeForm) {
            if (checkAuth) {
                if (!items.find(item => item == realPath) && $('.panels').length) {
                    setLocation(path);
                    return alert_message('Вы не можете вернуться на форму с авторизацией или регистрацией!', 'warning');
                } else if (items.find(item => item == realPath) && !$('.panels').length && authItems.find(item => item == path)) {
                    setLocation(path);
                    return alert_message('Вы не можете вернуться на форму, доступ к которой имеет только авторизированный пользователь!', 'warning');
                }

                if ($('.panels').length) {
                    $('.item').removeClass('active');
                    $(`.item > .${realPath}`).parent().addClass('active');    
                }
            }

            if (authItems.find(item => item == realPath)) drawPage(realPath);
            else drawItem(realPath, false);
        }

        old_location = location;
        path = realPath;
    }, 500);
})();

let scaled = null;

function correctShow(size) {
    if (size != 'ignore') scaled = size;
    
    const widthBody = window.innerWidth; //$('body').width();
    const heightBody = window.innerHeight; //$('body').height();
    const wScale = (widthBody / 1920);
    const hScale = (heightBody / 968);
    //const scale = wScale > hScale ? hScale : wScale;
    let scale = (wScale + hScale) / 2;

    if (scaled) {
        scale = size;
    }
    $('.set-scale').css('zoom', scale);
}

$(window).resize(function() {
    correctShow('ignore');
});
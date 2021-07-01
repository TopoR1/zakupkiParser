import mongodb from 'mongodb';
import Logger from './logger.js';

const { MongoClient } = mongodb;

class db {
    constructor() {
        this.db = null;
        this.connected = false;
        Logger.info('MongoDb: connecting to server...');
        this.connect();
    }
    async connect() {
        const time = Date.now();
        const client = await MongoClient.connect(``, { // ссылка на доступ к бд
            useNewUrlParser: true,
            useUnifiedTopology: false,
            auth: {
                username: '', // имя пользователя
                password: '' // пароль
            },
            authSource: '', // авторизация с бд
            autoReconnect: false
        }).catch(err => {});
    
        if (client) {
            this.db = client.db('gos');
            this.connected = true;
            Logger.info('MongoDb: server is connected!');
            this.check();
        } else {
            Logger.error('MongoDb: server is not connected! Reconnecting...');
            Date.now() - time < 1000 && await this.sleep(3000);
            await this.connect();
        }
    }
    async check() {
        if (!(!!this.db && !!this.db.topology && this.db.topology.isConnected()) && this.connected) {
            Logger.warn('MongoDb: server is disconnected! Reconnecting...');
            this.connected = false;
            this.db = null;
            return this.connect();
        }

        await this.sleep(500);
        this.check();
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default new db;
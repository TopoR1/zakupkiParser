import Logger from './logger.js';

class Commands {
    constructor() {
        this.list = {
            clear: () => {
                process.stdout.write("\u001b[2J\u001b[0;0H");
            },
            exit: () => {
                Logger.warn("Closing server...");
                process.exit(1);
            },
            restart: () => {
                Logger.warn("Restarting server...");
                process.exit(3);
            },
            r: () => {
                this.list.restart();
            }
        };
    }
}

export default new Commands;
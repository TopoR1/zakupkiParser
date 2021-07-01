import * as fs from 'fs';
import { format } from 'util';
import { EOL } from 'os';

const LogLevelEnum = {};

function define(name, value) {
    Object.defineProperty(LogLevelEnum, name, {
        value: value,
        enumerable: true,
        writable: false,
        configurable: false
    });
}

define('NONE', 0);
define('FATAL', 1);
define('ERROR', 2);
define('WARN', 3);
define('INFO', 4);
define('DEBUG', 5);

const logVerbosity = LogLevelEnum.DEBUG;
const logFileVerbosity = LogLevelEnum.DEBUG;
const logFolder = './logs';
const logBackupFolder = './logs/LogBackup';
const logFileName = 'ServerLog';

let consoleLog = null;
const color = {
    black: '\u001B[30m',
    red: '\u001B[31m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    blue: '\u001B[34m',
    magenta: '\u001B[35m',
    cyan: '\u001B[36m',
    white: '\u001B[37m',
    bright: '\u001B[1m'
};

class logger {
    debug(message) {
        writeCon(color.white, LogLevelEnum.DEBUG, message);
        writeLog(LogLevelEnum.DEBUG, message);
    }
    info(message) {
        writeCon(color.white + color.bright, LogLevelEnum.INFO, message);
        writeLog(LogLevelEnum.INFO, message);
    }
    warn(message) {
        writeCon(color.yellow + color.bright, LogLevelEnum.WARN, message);
        writeLog(LogLevelEnum.WARN, message);
    }
    error(message) {
        writeCon(color.red + color.bright, LogLevelEnum.ERROR, message);
        writeLog(LogLevelEnum.ERROR, message);
    }
    fatal(message) {
        writeCon(color.red + color.bright, LogLevelEnum.FATAL, message);
        writeLog(LogLevelEnum.FATAL, message);
    }
    print(message) {
        writeCon(color.white, LogLevelEnum.NONE, message);
        writeLog(LogLevelEnum.NONE, message);
    }
    write(message) {
        writeLog(LogLevelEnum.NONE, message);
    }
    writeDebug(message) {
        writeLog(LogLevelEnum.DEBUG, message);
    }
    writeError(message) {
        writeLog(LogLevelEnum.ERROR, message);
    }
    setVerbosity = (level) => {
        logVerbosity = level;
    }
    setFileVerbosity = (level) => {
        logFileVerbosity = level;
    }
    getVerbosity = () => {
        return logVerbosity;
    }
    getFileVerbosity = () => {
        return logFileVerbosity;
    }
    start() {
        if (writeStarted)
            return;
        writeStarted = true;
        try {
            console.log = this.print;
            
            const timeString = getDateTimeString();
            const fileName = `${logFolder}/${logFileName}.log`;
            const fileName2 = `${logBackupFolder}/${logFileName}-${timeString}.log`;
            
            if (!fs.existsSync(logFolder)) {
                // Make log folder
                fs.mkdirSync(logFolder);
            } else if (fs.existsSync(fileName)) {
                if (!fs.existsSync(logBackupFolder)) {
                    // Make log backup folder
                    fs.mkdirSync(logBackupFolder);
                }
                // Backup previous log
                fs.renameSync(fileName, fileName2);
            }
            
            fs.writeFileSync(fileName, `=== Started ${timeString} ===${EOL}`);
            const file = fs.createWriteStream(fileName, { flags: 'a' });
            file.on('open', () => {
                if (writeShutdown) {
                    file.close();
                    return;
                }
                consoleLog = file;
                flushAsync();
            });
            file.on('error', err => {
                writerError = true;
                consoleLog = null;
                writeCon(color.red + color.bright, LogLevelEnum.ERROR, err.message);
            });
        } catch (err) {
            writerError = true;
            consoleLog = null;
            writeCon(color.red + color.bright, LogLevelEnum.ERROR, err.message);
        }
    }
    shutdown() {
        writeShutdown = true;
        if (writerError) return;
        if (consoleLog != null) {
            consoleLog.end();
            consoleLog.close();
            consoleLog.destroy();
            consoleLog = null;
        }
        writeQueue.push(`=== Shutdown ${getDateTimeString()} ===${EOL}`);
        flushSync();
    }
}

export default new logger;

// --- utils ---

function getDateTimeString() {
    const date = new Date();
    let dy = date.getFullYear();
    let dm = date.getMonth() + 1;
    let dd = date.getDate();
    let th = date.getHours();
    let tm = date.getMinutes();
    let ts = date.getSeconds();
    let tz = date.getMilliseconds();
    dy = (`0000${dy}`).slice(-4);
    dm = (`00${dm}`).slice(-2);
    dd = (`00${dd}`).slice(-2);
    th = (`00${th}`).slice(-2);
    tm = (`00${tm}`).slice(-2);
    ts = (`00${ts}`).slice(-2);
    tz = (`000${tz}`).slice(-3);
    return `${dy}-${dm}-${dd}T${th}-${tm}-${ts}-${tz}`;
};

function getTimeString() {
    const date = new Date();
    let th = date.getHours();
    let tm = date.getMinutes();
    let ts = date.getSeconds();
    th = (`00${th}`).slice(-2);
    tm = (`00${tm}`).slice(-2);
    ts = (`00${ts}`).slice(-2);
    return `${th}:${tm}:${ts}`;
};

function writeCon(color, level, message) {
    if (level > logVerbosity) return;
    message = format(message);
    let prefix = '';
    if (level == LogLevelEnum.DEBUG)
        prefix = '[DEBUG] ';
    else if (level == LogLevelEnum.INFO)
        prefix = '[INFO ] ';
    else if (level == LogLevelEnum.WARN)
        prefix = '[WARN ] ';
    else if (level == LogLevelEnum.ERROR)
        prefix = '[ERROR] ';
    else if (level == LogLevelEnum.FATAL)
        prefix = '[FATAL] ';
    process.stdout.write(`${color}${prefix}${message}[0m${EOL}`);
};

function writeLog(level, message) {
    if (level > logFileVerbosity || writerError)
        return;
    message = format(message);
    let prefix = '';
    if (level == LogLevelEnum.DEBUG)
        prefix = '[DEBUG]';
    else if (level == LogLevelEnum.INFO)
        prefix = '[INFO ]';
    else if (level == LogLevelEnum.WARN)
        prefix = '[WARN ]';
    else if (level == LogLevelEnum.ERROR)
        prefix = '[ERROR]';
    else if (level == LogLevelEnum.FATAL)
        prefix = '[FATAL]';
    else if (level == LogLevelEnum.NONE)
        prefix = '[NONE ]';
    prefix += `[${getTimeString()}] `;
    
    writeQueue.push(prefix + message + EOL);
    if (writeShutdown) {
        flushSync();
    } else {
        if (writeCounter == 0) {
            flushAsync();
        }
    }
};

let writerError = false;
let writeCounter = 0;
let writeShutdown = false;
let writeStarted = false;
const writeQueue = [];

function flushAsync() {
    if (writeShutdown || consoleLog == null || writeQueue.length == 0) return;

    writeCounter++;
    consoleLog.write(writeQueue.shift(), () => { writeCounter--; flushAsync(); });
};

function flushSync() {
    try {
        let tail = '';
        while (writeQueue.length > 0) {
            tail += writeQueue.shift();
        }
        const fileName = `${logFolder}/${logFileName}.log`;
        fs.appendFileSync(fileName, tail);
    } catch (err) {
        writerError = true;
        writeCon(color.red + color.bright, LogLevelEnum.ERROR, err.message);
        writeCon(color.red + color.bright, LogLevelEnum.ERROR, 'Failed to append log file!');
    }
};
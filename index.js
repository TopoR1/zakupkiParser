// Imports
import Logger from './modules/logger.js';
import Commands from './modules/commands.js';
import * as Server from './server.js';
import { createInterface } from 'readline';
const version = '1.01.0';

// Init variables
let showConsole = true;

// Start msg
Logger.start();

process.on('exit', code => {
    Logger.debug(`process.exit(${code})`);
    Logger.shutdown();
});

process.on('uncaughtException', err => {
    Logger.fatal(err.stack);
    Logger.warn("RESTARTING SERVER");
    process.exit(3);
});

process.on('unhandledRejection', err => {
    console.log('Обнаружена ошибка: \n');

    console.log(err);
});

// Handle arguments
process.argv.forEach(val => {
    if (val == "--noconsole") {
        showConsole = false;
    } else if (val == "--help") {
        console.log("Proper Usage: node index.js");
        console.log("    --noconsole         Disables the console");
        console.log("    --help              Help menu.");
        console.log("");
    }
});

// Run
Logger.info(`[1m[32mZakupkiParser ${version}[37m - by TopoR.[0m`);
// Initialize the server console
let in_ = null;

if (showConsole) {
    in_ = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    setTimeout(prompt, 100);
}

// Console functions

function prompt() {
    in_.question(">", str => {
        try {
            parseCommands(str);
        } catch (err) {
            Logger.error(err.stack);
        } finally {
            setTimeout(prompt, 0);
        }
    });
}

function parseCommands(str) {
    // Log the string
    Logger.write(`>${str}`);

    // Don't process ENTER
    if (!str) return;

    // Splits the string
    const split = str.split(" ");

    // Process the first string value
    const first = split[0].toLowerCase();

    // Get command function
    const execute = Commands.list[first];
    if (typeof execute != 'undefined') execute(split);
    else Logger.warn("Invalid Command!");
}
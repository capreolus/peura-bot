/*
 * Author(s): Kaura Peura, 2017
 */

const log = require('./lib/log.js');
const DeerBot = require('./lib/deer-bot.js');

try {
    const deerBot = new DeerBot(require('./config.json'));
} catch (error) {
    log.error(error);
    process.exit(1);
}

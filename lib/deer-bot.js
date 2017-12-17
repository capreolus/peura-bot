/*
 * Author(s): Kaura Peura, 2017
 */

const fs = require('fs');
const zlib = require('zlib');

const log = require('./log.js');
const Options = require('./options.js');
const RateLimiter = require('./rate-limiter.js');
const WikiGenerator = require('./wiki-generator.js');
const TelegramBot = require('./telegram-bot.js');

/**
 * A class encapsulating deer bot functionality.
 */
class DeerBot {
   /**
    * Constructs a new deer bot.
    * @param {config} config - The configurataion for the bot.
    * @param {object} [options] - The options for the bot.
    * @param {string} [options.dataPath] - The data storage path for the bot ('./data/').
    * @param {string} [options.maxUserRequestsPerMinute] - The maximum number of requests from a single non-admin user per minute (10).
    * @param {number} [options.sentenceLength] - The approximate length of the generated sentences (50).
    * @param {number} [options.sentenceConstantAlpha] - The alpha constant for sentence scoring (2.0).
    * @param {number} [options.sentenceConstantBeta] - The beta constant for sentence scoring (1.5).
    * @param {number} [options.sentenceSampleCount] - The sample count for sentence generation (1000).
    */
    constructor(config, options) {
        this._config = config;

        this._options = new Options({
            dataPath: './data/',
            maxUserRequestsPerMinute: 10,
            sentenceLength: 50,
            sentenceConstantAlpha: 2.0,
            sentenceConstantBeta: 1.5,
            sentenceSampleCount: 1000
        }, options);

        this._awake = false;
        this._users = new Map();

        this._wikiGenerator = new WikiGenerator();
        this._telegramBot = new TelegramBot(config.token);
        this._telegramBot.on('error', (error) => { this._onError(error); });
        this._telegramBot.on('message', (msg, respond) => { this._onMessage(msg, respond); });
    }

    /**
     * The handler for error events.
     * @param {Error} error - The error.
     * @private
     */
    _onError(error) {
        log.error(error.message);
    }

    /**
     * The handler for message events.
     * @param {object} msg - The Telegram message object for the event.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _onMessage(msg, respond) {
        const text = msg.text;
        const args = text.split(' ');
        if (args.length < 1) { return; }

        const user = msg.from != null ? msg.from.username : null;
        if (user == null) { return; }

        let cmd = args[0].toLowerCase();
        if (cmd == null || !cmd.startsWith('/')) { return; }

        let cmdString = cmd.slice(1);
        if (/[^a-z]/.test(cmdString)) { return; }

        try {
            this._onCommand(user, cmdString, args.slice(1), (text) => { respond(text, true); });
        } catch (error) {
            log.error('Error while processing message:', error);
        }
    }

    /**
     * The handler for command events.
     * @param {object} user - The user who sent the command.
     * @param {string} cmd - The command string.
     * @param {Array} args - The command arguments.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _onCommand(user, cmd, args, respond) {
        log.debug('Received command:', cmd, args, 'from user:', user);
        const fromAdmin = this._config.admins.indexOf(user) !== -1;

        if (fromAdmin) {
            switch(cmd) {
                case 'kick':
                case 'start': {
                    if (!this._awake) {
                        this._awake = true;
                        respond('*Windows 98 SE startup noises*');
                    } else {
                        respond('*whine*');
                    } return;
                }

                case 'sleep':
                case 'stop': {
                    if (this._awake) {
                        this._awake = false;
                        respond('*Windows 98 SE shutdown sound*');
                    } else {
                        respond('*snore*');
                    } return;
                }

                case 'write':
                case 'read': {
                    this._processIOCommand(cmd, args, respond);
                    return;
                }

                case 'set': {
                    this._processSettingsCommand(cmd, args, respond);
                    return;
                }
            }
        }

        const userEntry = this._getUserEntry(user);
        if (!userEntry.rateLimiter.tryRemoveTokens(1)) {
            if (fromAdmin) { respond('*slaps ' + user + ' with a hoof*'); }
            log.debug('Rate limiting user:', user);
            return;
        }

        if (this._awake) {
            switch(cmd) {
                case 'study': {
                    this._processStudyCommand(args, respond);
                    break;
                }

                case 'explain': {
                    this._processExplainCommand(args, respond);
                    break;
                }

                case 'help': {
                    this._processHelpCommand(respond);
                    break;
                }

                default: {
                    const responses = this._config.responses;
                    if (responses[cmd] != null) { respond(pickResponse(responses[cmd])); }
                    break;
                }

            }
        } else {
            respond('*Zzz...*');
        }
    }

    /**
     * Processes a settings command.
     * @param {string} cmd - The command.
     * @param {Array} args - The command arguments.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _processSettingsCommand(cmd, args, respond) {
        if (args.length < 1) {
            respond(errorText('No parameter specified.'));
            return;
        }

        if (args.length < 2) {
            respond(errorText('No value specified.'));
            return;
        }

        if (args.length > 2) {
            respond(errorText('Invalid number of arguments.'));
            return;
        }

        const parameter = args[0];
        const value = args[1];

        const mapped = {
            'sentence-length': 'sentenceLength',
            'sentence-constant-alpha': 'sentenceConstantAlpha',
            'sentence-constant-beta': 'sentenceConstantBeta',
            'sentence-sample-count': 'sentenceSampleCount'
        }[parameter];

        if (mapped == null) {
            respond(errorText('Unknown parameter: ' + parameter));
            return;
        };

        const number = Number(value);

        switch (parameter) {
            case 'sentence-length':
            case 'sentence-sample-count': {
                if (Number.isSafeInteger(number) && number > 0) {
                    this._options[mapped] = number;
                } else {
                    respond(errorText('Invalid value.'));
                    return;
                } break;
            }

            case 'sentence-constant-alpha':
            case 'sentence-constant-beta': {
                if (Number.isFinite(number) && number > 0.0) {
                    this._options[mapped] = number;
                } else {
                    respond(errorText('Invalid value.'));
                    return;
                } break;
            }

            default: {
                respond('*impossible bleat*');
                return;
            }
        }

        respond('*changed ' + parameter + ' to ' + value + '*');
        log.debug('Current options:', this._options);
    }

    /**
     * Processes an IO command.
     * @param {string} cmd - The command.
     * @param {Array} args - The command arguments.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _processIOCommand(cmd, args, respond) {
        if (this._awake) {
            respond('*sleepy noises*');
            return;
        }

        if (args.length < 1) {
            respond(errorText('No file name specified.'));
            return;
        }

        if (args.length > 1) {
            respond(errorText('Invalid number of arguments.'));
            return;
        }

        const name = args[0];

        try {
            switch (cmd) {
                case 'write': {
                    this._toFile(name, this._wikiGenerator.toDataObject());
                    respond('*recorder sounds*');
                    break;
                }

                case 'read': {
                    this._wikiGenerator = WikiGenerator.newFromDataObject(this._fromFile(name));
                    respond('*playback sounds*');
                    break;
                }

                default: {
                    respond(erroText('Unknown command: ' + cmd));
                    return;
                }
            }
        } catch (error) {
            log.error('Error reading or writing file:', error.message);
            respond(errorText('Couldn\'t access file ' + name));
        }
    }

    /**
     * Processes a help command.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _processHelpCommand(respond) {
        const name = this._config.name;
        const languages = [this._config.wiki.languages].join(', ');

        respond((
            '{{name}} loves commands!\n' +
            '\n' +
            '/study (' + languages + ') [topic] - Have {{name}} learn about a topic.\n' +
            '/explain (' + languages + ') [keywords] - Have {{name}} explain things.\n' +
            '\n' +
            'Find {{name}} at: https://github.com/capreolus/peura-bot'
        ).replace(/{{name}}/g, '' + this._config.name));
    }

    /**
     * Processes a study command.
     * @param {Array} args - The command arguments.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _processStudyCommand(args, respond) {
        if (args.length < 1) {
            respond(errorText('No language specified.'));
            return;
        }

        const language = args[0].toLowerCase();
        if (!this._checkLanguage(language, respond)) { return; }

        if (args.length < 2) {
            respond(errorText('No topic specified.'));
            return;
        }

        const topic = args.slice(1).join('_');

        (async () => {
            try {
                const result = await this._wikiGenerator.analyze(language, topic);

                switch (result) {
                    case -1: { respond('*has already checked ' + topic + '*');                   break; }
                    case  0: { respond('*couldn\'t learn anything new about ' + topic + '*');    break; }
                    default: { respond('*analyzed ' + result + ' symbols about ' + topic + '*'); break; }
                }
            } catch (error) {
                respond(errorText(error.message));
            }
        })();
    }

    /**
     * Processes an explain command.
     * @param {Array} args - The command arguments.
     * @param {function} respond - The callback for creating a response.
     * @private
     */
    _processExplainCommand(args, respond) {
        if (args.length < 1) {
            respond(errorText('No language specified.'));
            return;
        }

        const language = args[0].toLowerCase();
        if (!this._checkLanguage(language, respond)) { return; }

        const keywords = args.slice(1);
        const options = this._options;

        const sentence = this._wikiGenerator.generate(
            language,
            options.sentenceLength,
            options.sentenceLength * 2,
            keywords,
            options.sentenceSampleCount,
            options.sentenceConstantAlpha,
            options.sentenceConstantBeta
        ).sentence;

        if (sentence.length < 1) {
            respond('*wet, sad bleat of failure*');
        } else {
            respond(sentence);
        }
    }

    /**
     * Checks that given language is supported.
     * @param {string} language - The language to check.
     * @param {function} respond - The respond function for notifying the user on invalid language.
     * @return {boolean} Whether the language is supported or not.
     * @private
     */
    _checkLanguage(language, respond) {
        if (this._config.wiki.languages.indexOf(language) === -1) {
            respond(errorText('Unsupported language: ' + language));
            return false;
        }

        return true;
    }

    /**
     * Returns the user entry for given name. Creates a new entry if necessary.
     * @param {string} name - The name of the user to get the entry for.
     * @return {object} The user entry.
     * @private
     */
    _getUserEntry(name) {
        let entry = this._users.get(name);
        if (entry != null) { return entry; }

        entry = { rateLimiter: new RateLimiter(this._options.maxUserRequestsPerMinute, 60000) };
        this._users.set(name, entry);
        return entry;
    }

    /**
     * Writes given JSON serializable object to the file with given name.
     * @param {string} name - The name of the file to create (excluding any extensions).
     * @param {object} obj - The object to write.
     * @private
     */
    _toFile(name, obj) {
        testFileName(name);

        const buffer = Buffer.from(JSON.stringify(obj));
        const deflated = zlib.gzipSync(buffer);

        const path = this._options.dataPath + name + '.json.gz';
        log.debug('Writing to file:', path);
        fs.writeFileSync(path, deflated);
    }

    /**
     * Reads a JSON serializable object from the file with given name.
     * @param {string} name - The name of the file to read (excluding any extensions).
     * @return {object} The object that was read.
     * @private
     */
    _fromFile(name) {
        testFileName(name);

        const path = this._options.dataPath + name + '.json.gz';
        log.debug('Reading from file:', path);
        const buffer = fs.readFileSync(path);

        const text = zlib.gunzipSync(buffer).toString();
        return JSON.parse(text);
    }
}

/**
 * Picks and decorates a random response from an array strings.
 * @param {Array} array - The array of strings to pick the response from.
 * @return {string} The response.
 * @private
 */
function pickResponse(array) {
    if (array.length < 1) { return '*undefined bleat*'; }
    const index = Math.floor(Math.random() * array.length);
    return '*' + array[Math.max(0, Math.min(array.length - 1, index))] + '*';
}

/**
 * Creates an error message.
 * @param {string} message - The error string.
 * @return {string} The decorated error message.
 * @private
 */
function errorText(message) {
    return '*blerror* - ' + message;
}

/**
 * Tests a file name for some potentially dangerous characters.
 * @param {string} name - The file name to test.
 * @private
 */
function testFileName(name) {
    if (/\./.test(name)) { throw Error('Invalid file name.'); }
}

module.exports = DeerBot;

/*
 * Author(s): Kaura Peura, 2017
 */

const fetch = require('node-fetch');
const EventEmitter = require('events').EventEmitter

const log = require('./log.js');
const Options = require('./options.js');
const RateLimiter = require('./rate-limiter.js');

/**
 * A class for interfacing with a Telegram bot.
 */
class TelegramBot extends EventEmitter {
    /**
     * Constructs a new Telegram bot.
     * @param {string} token - The bot API token.
     * @param {object} [options] - The options for the bot.
     * @param {number} [options.maxErrorsPerHour] - The maximum number of errors per hour (3).
     * @param {number} [options.maxRequestsPerHour] - The maximum number of requests per minute (120).
     * @param {number} [options.maxResponseLength] - The maximum length of an response in characters (4096)
     * @param {number} [options.messageTimeout] - The time window in milliseconds after which a message is ignored (15000).
     * @param {number} [options.pollDelay] - The delay in milliseconds after a successful poll before polling again (1000).
     * @param {number} [options.pollErrorDelay] - The delay in milliseconds after a failed poll before polling again (60000).
     * @param {number} [options.pollTimeout] - The timeout value in seconds for polling updates via the Telegram bot API (300).
     */
    constructor(token, options) {
        super();

        this._options = new Options({
            maxErrorsPerHour: 3,
            maxRequestsPerMinute: 120,
            maxResponseLength: 4096,
            messageTimeout: 15000,
            pollDelay: 1000,
            pollErrorDelay: 60000,
            pollTimeout: 300
        }, options);

        this._errorLimiter   = new RateLimiter(this._options.maxErrorsPerHour, 3600000);
        this._requestLimiter = new RateLimiter(this._options.maxRequestsPerMinute, 60000);

        this._baseURL = 'https://api.telegram.org/bot' + token + '/';
        this._updateOffset = 0;

        this._runPollLoop();
    }

    /**
     * Runs the internal update polling loop.
     * @private
     */
    async _runPollLoop() {
        try {
            await this._processUpdates();
            setTimeout(() => { this._runPollLoop(); }, this._options.pollDelay);
        } catch (error) {
            this._emitError(Error('Error while polling updates:', error.message));

            if (!this._errorLimiter.tryRemoveTokens(1)) {
                log.error('Maximum number of errors per hour exceeded, exiting.');
                process.exit(1);
            }

            setTimeout(() => { this._runPollLoop(); }, this._options.pollErrorDelay);
        }
    }

    /**
     * Reads and processes any pending updates.
     * @return {Promise} A promise that resolves on success and rejects otherwise with an error.
     * @private
     */
    async _processUpdates() {
        log.debug('Polling updates...');

        const data = await this._createRequest('getUpdates', {
            offset:  this._updateOffset,
            timeout: this._options.pollTimeout,
            allowedUpdates: ['message']
        });

        const now = Date.now();

        for (let update of data.result) {
            this._updateOffset = update.update_id + 1;
            const message = update.message;

            if (message != null && message.text != null && now - message.date * 1000 <= this._options.messageTimeout) {
                log.debug('Message:', message);

                this.emit('message', message, async (text, reply) => {
                    try { await this._respond(message, text, reply); }
                    catch (error) { this._emitError(error); }
                });
            }
        }
    }

    /**
     * Responds to a message.
     * @param {object} message - The Telegram message object to respond to.
     * @param {string} text - The response text.
     * @param {boolean} [reply] - Whether to reply to the original message directly.
     * @return {Promise} A promise that resolves on success and rejects otherwise with an error.
     * @private
     */
    async _respond(message, text, reply) {
        const params = {
            chat_id: message.chat.id,
            disable_notification: true,
            disable_web_page_preview: true,
            text: text.substr(0, Math.min(text.length, this._options.maxResponseLength))
        }

        if (reply === true) {
            params.reply_to_message_id = message.message_id;
        }

        await this._createRequest('sendMessage', params);
    }

    /**
     * Creates a new request against the Telegram bot API.
     * @param {string} method - The name of the API method to call.
     * @param {object} params - The request parameters.
     * @return {Promise} A promise that resolves with the API response on success and rejects otherwise with an error.
     * @private
     */
     async _createRequest(method, params) {
        if (!this._requestLimiter.tryRemoveTokens(1)) {
            throw Error('Request rate limit exceeded.');
        }

        const request = {
            method: 'POST',
            headers: {
              'Accept':       'application/json',
              'Content-Type': 'application/json'
            },

            body: JSON.stringify(params)
        }

        const res = await fetch(this._baseURL + method, request);
        if (!res.ok) { throw Error('Request failed: ' + res.statusText); }

        const data = await res.json();
        if (!data.ok) { throw Error('Request failed: ' + data.description || 'Unknown error.'); }

        return data;
    }

    /**
     * Safely emits an error.
     * @param {Error} error - The error to emit.
     * @private
     */
    _emitError(error) {
        try {
            this.emit(error);
        } catch (error) {
            log.error('Error while emitting error, exiting.');
            process.exit(1);
        }
    }
}

module.exports = TelegramBot;

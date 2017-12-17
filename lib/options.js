/*
 * Author(s): Kaura Peura, 2017
 */

/**
 * A type for handling optional parameters.
 */
class Options {
    /**
     * Constructs new options.
     * @param {object} defaults - The default values.
     * @param {object} [options] - The user options.
     */
    constructor(defaults, options) {
        options = options || {};
        for (let [key, value] of Object.entries(defaults)) {
            this[key] = typeof options[key] !== 'undefined' ? options[key] : value;
        }
    }
}

module.exports = Options;

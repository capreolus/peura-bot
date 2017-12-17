/*
 * Author(s): Kaura Peura, 2017
 */

function getDate() {
    return '[' + (new Date()).toUTCString() + ']';
}

module.exports = {
    debug(...args) { console.log(getDate(), ...args) },
    error(...args) { console.error(getDate(), ...args) }
};

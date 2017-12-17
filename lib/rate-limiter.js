/*
 * Author(s): Kaura Peura, 2017
 */

/**
 * A bucket of tokens type rate limiter.
 */
class RateLimiter {
    /**
     * Constructs a new rate limiter.
     * @param {number} capacity - The capacity of the token bucket.
     * @param {number} fillTime - The time in milliseconds it takes to completely fill an empty token bucket.
     * @param {number} [initialCount] - The initial number of tokens in the bucket. Defaults to a filled bucket.
     */
    constructor(capacity, fillTime, initialCount) {
        if (typeof capacity !== 'number' || capacity < 1.0) { throw Error('Invalid bucket capacity.'); }
        if (typeof fillTime !== 'number' || fillTime < 1.0) { throw Error('Invalid bucket fill time.'); }

        if (initialCount != null && (typeof initialCount !== 'number' || initialCount < 0.0)) {
            throw Error('Invalid initial token count.');
        }

        this._capacity = Math.floor(capacity);
        this._fillTime = Math.floor(fillTime);

        this._count = typeof initialCount === 'number' ? Math.max(0.0, Math.min(capacity, initialCount)) : capacity;
        this._lastAdded = Date.now();
    }

    /**
     * @return {number} The number of tokens in the bucket currently.
     */
    get count() {
        this._addTokens();
        return this._count;
    }

    /**
     * Tries to remove tokens from the bucket.
     * @param {number} count - The number of tokens to remove.
     * @return {boolean} True if removing the tokens was successful, otherwise false.
     */
    tryRemoveTokens(count) {
        this._addTokens();

        if (this._count >= count) {
            this._count -= count;
            return true;
        }

        return false;
    }

    /**
     * Adds tokens to the token bucket based on the time elapsed.
     * @private
     */
    _addTokens() {
        const now = Date.now();
        const dt = now - this._lastAdded;

        if (dt > 0) {
            const toAdd = dt * this._capacity / this._fillTime;
            this._count = Math.max(0.0, Math.min(this._capacity, this._count + toAdd));
        }

        this._lastAdded = now;
    }
}

module.exports = RateLimiter;

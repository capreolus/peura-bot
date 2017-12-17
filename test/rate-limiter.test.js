/*
 * Author(s): Kaura Peura, 2017
 */

const assert = require('assert');
const sinon = require('sinon')

const RateLimiter = require('../lib/rate-limiter.js');

const input = {
    capacity: 100,
    fillTime: 1000,
    initialCount: 5
};

describe('RateLimiter', function () {
    let clock;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
    });

    afterEach(function () {
        clock.restore();
    });

    it('the initial number of tokens is set automatically', function () {
        const rateLimiter = new RateLimiter(input.capacity, input.fillTime);
        assert.equal(rateLimiter.count, input.capacity);
    });

    it('tokens are added and removed', function () {
        const rateLimiter = new RateLimiter(input.capacity, input.fillTime, input.initialCount);
        assert.equal(rateLimiter.count, input.initialCount);

        clock.tick(input.fillTime / 10);
        assert.equal(rateLimiter.count, input.initialCount + input.capacity / 10);

        clock.tick(input.fillTime);
        assert.equal(rateLimiter.count, input.capacity);

        assert(rateLimiter.tryRemoveTokens(5));
        assert.equal(rateLimiter.count, input.capacity - 5);
        assert(!rateLimiter.tryRemoveTokens(input.capacity));
        assert.equal(rateLimiter.count, input.capacity - 5);
    });
});

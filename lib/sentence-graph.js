/*
 * Author(s): Kaura Peura, 2017
 */

/**
 * A sentence generator based on Markov chains.
 */
class SentenceGraph {
    /**
     * Constructs a new sentence graph.
     * @param {number} order - The length of the sentence tail in words.
     * @param {Map} [graph] - The initial graph (private).
     */
    constructor(order, graph) {
        this._order = Math.max(1, Math.floor(order));
        this._graph = graph != null ? graph : new Map();
    }

    /**
     * Constructs a new sentence graph from a sentence graph data object.
     * @param {object} data - The data object to construct the new sentence graph from.
     * @return {SentenceGraph} The new sentence graph.
     */
    static newFromDataObject(data) {
        return new SentenceGraph(data.order, new Map(data.graphData));
    }

    /**
     * @return {object} A JSON serializable object that can be used to construct a copy of the sentence graph.
     */
    toDataObject() {
        return { order: this._order, graphData: Array.from(this._graph) };
    }

    /**
     * Analyzes an array of word representing one or more sentences.
     * @param {Array} words - The array of words to analyze.
     */
    analyze(words) {
        if (words.length === 0) { return; }

        let tail = '';
        const queue = [];

        for (let word of words) {
            updateNode(this._nodeAt(tail), word);

            queue.push(word);
            if (queue.length > this._order) { queue.shift(); }
            tail = toTail(queue);
        }

        // Extra weight exceeding the total sum of edge weights measure the change of the sentence ending.

        this._nodeAt(tail).weight++;
        this._nodeAt(tail).isExit = true;
    }

    /**
     * Generates a sentence.
     * @param {number} length - The length of the sentence in words to generate.
     * @param {number} maxlength - The maximum length of the sentence in words to generate.
     * @param {Array} keywords - The array of keywords to look for.
     * @param {number} alpha - The power to raise edge unlikeliness to when summing edge scores, clamped to [0.0625, 16.0].
     * @param {number} beta - The power to raise keyword match count before multiplying score with it, clamped to [0.0625, 16.0].
     * @return {object} The resulting sentence and its score.
     */
    generate(length, maxLength, keywords, alpha, beta) {
        alpha = Math.max(0.0625, Math.min(16.0, alpha));
        beta = Math.max(0.0625, Math.min(16.0, beta));

        let sentence = '';
        let queue = [];
        let found = [];
        let score = 0;

        keywords = keywords.map((x) => x.toLowerCase());
        keywords = Array.from(new Set(keywords));
        let remaining = keywords.slice(0);

        const order = this._order;

        for (let i = 0; i < maxLength; i++) {
            let node = this._nodeAt(toTail(queue));

            if (node.weight === 0) {
                break;
            } else if (i >= length && node.isExit) {
                return buildResult();
            }

            if (remaining.length > 0) {
                const matches = createMatchNode(node, remaining, found);
                if (matches.weight > 0) { node = matches; }
            }

            const sampleResult = sampleNode(node);
            const chance = sampleResult.chance;
            const word = sampleResult.word;

            if (chance > 0.0) { score += Math.pow(1.0 / chance, alpha); }

            if (word == null) {
                if (i < length) {
                    sentence += ' ';
                    queue = [];
                    continue;
                }

                return buildResult();
            }

            queue.push(word);
            if (queue.length > order) { queue.shift(); }
            sentence += word;

            const lowercase = word.toLowerCase();
            const matchIndex = remaining.findIndex((x) => lowercase.indexOf(x) !== -1);

            if (matchIndex !== -1 && found.indexOf(word) === -1) {
                found.push(word);
                remaining.splice(matchIndex, 1);
                if (remaining.length < 1) { remaining = keywords.slice(0); }
            }
        }

        return { sentence: '', score: 0 };

        function buildResult() {
            return { sentence: sentence, score: score * Math.pow(found.length, beta) };
        }
    }

    /**
     * Returns the node entry for given sentence tail.
     * @param {object} tail - The sentence tail to get the node for.
     * @return {object} The node entry.
     * @private
     */
    _nodeAt(tail) {
        let node = this._graph.get(tail);
        if (node != null) { return node; }

        node = createEmptyNode();
        this._graph.set(tail, node);
        return node;
    }
}

/**
 * Searches a node for keywords.
 * @param {object} node - The node to search.
 * @param {Array} keywords - An array of strings containing the keywords to find by partial or full match.
 * @param {Array} found - An array of strings containing exact matches that have been found already.
 * @return {object} A new node containing all matches not previously found.
 * @private
 */
function createMatchNode(node, keywords, found) {
    const result = createEmptyNode();
    const links = node.links;
    const freqs = node.freqs;

    for (let i = 0; i < links.length; i++) {
        const word = links[i];

        if (found.indexOf(word) !== -1) { continue; }
        const lowercase = word.toLowerCase();

        for (let keyword of keywords) {
            if (lowercase.indexOf(keyword) !== -1) {
                const freq = freqs[i];
                result.links.push(word);
                result.freqs.push(freq);
                result.weight += freq;
            }
        }
    }

    return result;
}

/**
 * Updates a node entry by increasing the weight of given edge by one. A new edge is added if necessary.
 * @param {object} node - The node entry to update.
 * @param {string} word - The word whose edge to increase in weight.
 * @private
 */
function updateNode(node, word) {
    const index = node.links.indexOf(word);

    if (index === -1) {
        node.links.push(word);
        node.freqs.push(1);
    } else {
        node.freqs[index]++;
    }

    node.weight++;
}

/**
 * Samples a word from given node.
 * @param {object} node - The node to sample.
 * @return {string|null} The result of the sampling or null if the node was empty.
 * @private
 */
function sampleNode(node) {
    if (node.weight === 0) { return { word: null, chance: 1.0 }; }

    let pick = Math.floor(Math.random() * node.weight);
    let chance = 1.0;
    let word = null;

    const freqs = node.freqs;
    for (let edge = 0; edge < freqs.length; edge++) {
        const freq = freqs[edge];

        if (pick < freq) {
            chance = freq / node.weight;
            word = node.links[edge];
            break;
        }

        pick -= freq;
    }

    return { word, chance };
}

/**
 * Creates an empty graph tree node.
 * @return {object} An empty graph tree node.
 * @private
 */
function createEmptyNode() {
    return { links: [], freqs: [], weight: 0, isExit: false };
}

/**
 * Creates a sentence tail from a tail queue.
 * @param {Array} queue - The tail queue to process.
 * @return {string} The resulting sentence tail.
 * @private
 */
function toTail(queue) {
    return queue.join('').toLowerCase();
}

module.exports = SentenceGraph;

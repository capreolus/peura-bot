/*
 * Author(s): Kaura Peura, 2017
 */

const fetch = require('node-fetch');
const queryString = require('querystring');

const log = require('./log.js');
const Options = require('./options.js');
const RateLimiter = require('./rate-limiter.js');
const SentenceGraph = require('./sentence-graph.js');

/**
 * A stateful Wikipedia based sentence generator.
 */
class WikiGenerator{
    /**
     * Constructs a new wiki generator.
     * @param {object} [options] The options for the generator.
     * @param {number} [options.maxRequestsPerMinute] The maximum number of requests per minute (12).
     * @param {number} [options.minInputLength] The minimum length of text segment in characters to accept it for analysis (20).
     * @param {number} [options.sentenceGraphOrder] The order of the sentence graph used (4).
     * @param {object} [library] The initial set of library data (private).
     * @param {object} [graphs] The initial set of sentence graphs (private).
     **/
    constructor(options, library, graphs) {
        this._options = new Options({
            maxRequestsPerMinute: 12,
            minInputLength: 20,
            sentenceGraphOrder: 4
        }, options);

        this._requestLimiter = new RateLimiter(this._options.maxRequestsPerMinute, 60000);

        this._library = library != null ? library : {};
        this._graphs = graphs != null ? graphs : {};
    }

    /**
     * Constructs a new wiki generator from a wiki generator data object.
     * @param {object} data - The data object to construct the new wiki generator from.
     * @return {WikiGenerator} The new wiki generator.
     */
    static newFromDataObject(data) {
        const library = {};
        for (const [language, entry] of Object.entries(data.libraryData)) {
            library[language] = {};
            library[language].queries = new Set(entry.queries);
            library[language].analyzed = new Set(entry.analyzed);
        }

        const graphs = {};
        for (const [language, languageData] of Object.entries(data.graphsData)) {
            graphs[language] = SentenceGraph.newFromDataObject(languageData);
        }

        return new WikiGenerator(data.options, library, graphs);
    }

    /**
     * @return {object} A JSON serializable object that can be used to construct a copy of the wiki generator.
     */
    toDataObject() {
        const libraryData = {};
        for (const [key, entry] of Object.entries(this._library)) {
            libraryData[key] = {};
            libraryData[key].queries = Array.from(entry.queries);
            libraryData[key].analyzed = Array.from(entry.analyzed);
        }

        const graphsData = {};
        for (const [key, graph] of Object.entries(this._graphs)) {
            graphsData[key] = graph.toDataObject();
        }

        return {
            options: this._options,
            libraryData: libraryData,
            graphsData: graphsData
        }
    }

    /**
     * Analyzes given title on wikipedia.
     * @param {string} language - The language to analyze the title in. Must be a valid Wikipedia subdomain such as "en".
     * @param {string} title - The title of the article to analyze.
     * @return {number} The number of (abstract) words analyzed or -1 if the article has been analyzed already.
     */
    async analyze(language, title) {
        this._library[language] = this._library[language] || { queries: new Set(), analyzed: new Set() };
        const queries = this._library[language].queries;
        if (queries.has(title)) { return -1; }

        const illegal = /[\|]/;

        if (illegal.test(language) || illegal.test(title)) { throw Error('Illegal characters in the parameters.'); }
        if (!this._requestLimiter.tryRemoveTokens(1)) { throw Error('Request rate limit exceeded.'); }

        const request = {
            action: 'query',
            exlimit: 1,
            explaintext: true,
            exsectionformat: 'plain',
            format: 'json',
            prop: 'extracts',
            titles: title
        };

        const url = 'https://' + language + '.wikipedia.org/w/api.php?' + queryString.stringify(request);

        log.debug('Fetching:', url);
        const res = await fetch(url);
        log.debug('Response:', res.status, res.statusText);
        if (!res.ok) { throw Error('Failed to fetch:', url); }

        const data = await res.json();
        log.debug('Data:', JSON.stringify(data));

        const query = data.query;
        if (query == null) { throw Error('Missing query data.'); }

        const pages = query.pages
        if (pages == null) { throw Error('Missing page data.'); }

        let segments = [];
        const analyzed = this._library[language].analyzed;

        for (let pageId of Object.keys(pages)) {
            const page = pages[pageId];

            const title = page.title;
            if (title == null || analyzed.has(title)) { continue; }
            analyzed.add(title);

            const text = page.extract;
            if (text == null) { continue; }

            log.debug('Title:', title);
            segments = segments.concat(this._formatText(text));
        }

        log.debug('Segments:', segments.join('|'));

        this._graphs[language] = this._graphs[language] || new SentenceGraph(this._options.sentenceGraphOrder);
        const graph = this._graphs[language];

        let count = 0;
        for (let segment of segments) {
            const words = parseWords(segment);

            log.debug('Analyzing words:', words.length, JSON.stringify(words.slice(0, 5)) + '...');
            graph.analyze(words);
            count += words.length;
        }

        queries.add(title);
        return count;
    }

    /**
     * Generates text on given subject.
     * @param {string} language - The language to generate the text in. Should be an analyzed Wikipedia subdomain such as "en".
     * @param {number} length - The approximate length of the text to generate in words.
     * @param {number} maxLength - The maximum length of the text to generate in words.
     * @param {Array} keywords - The array of titles for text generation.
     * @param {number} samples - The number of samples to generate before settling for a result.
     * @param {number} alpha - The alpha constant for sentence scoring.
     * @param {number} beta - The beta constant for sentence scoring.
     */
    generate(language, length, maxLength, keywords, samples, alpha, beta) {
        const graph = this._graphs[language];
        if (graph == null) { throw Error('Unknown language:', language); }

        let candidate = {
            sentence: '',
            score: 0
        }

        log.debug('Generating a sentence about:', keywords.join(' '));

        for (let i = 0; i < samples; i++) {
            const result = graph.generate(length, maxLength, keywords, alpha, beta);
            if (result.score > candidate.score) { candidate = result; }
        }

        log.debug('Generated the following sentence:', candidate);
        return candidate;
    }

    /**
     * Formats given text into segments for analysis.
     * @param {string} text - The text to format.
     * @return {Array} An array of formatted text segments
     * @private
     */
    _formatText(text) {
        const segments = text.split('\n');
        const result = [];

        for (let segment of segments) {
            const trimmed = segment.trim();
            if (trimmed < 1) { continue; }

            const begin = trimmed.charAt(0);
            if (begin === begin.toLowerCase()) { continue; }

            const length = trimmed.lastIndexOf('.') + 1;
            if (length < this._options.minInputLength) { continue; }

            let str = trimmed.substr(0, length);

            str = str.replace(/\s+/g, ' ');
            str = str.replace(/[\(\[{]\s/, (match, p1) => p1);
            str = str.replace(/\s([,;:\)\]}])/, (match, p1) => p1);

            str = completeParens(str, '(', ')');
            str = completeParens(str, '[', ']');
            str = completeParens(str, '{', '}');

            result.push(str);
        }

        return result;

        function completeParens(str, left, right) {
            return str.lastIndexOf(left) <= str.lastIndexOf(right) ? str : str + right;
        }
    }
};

/**
 * Parses given text into logical words for analysis by the sentence generator.
 * @param {string} text - The text to parse.
 * @return {Array} The resulting array of words.
 * @private
 */
function parseWords(text) {
    const matcher = /[åÅäÄöÖa-zA-Z]+|[0-9]+|\s+|./g
    const result = [];

    let match;
    while ((match = matcher.exec(text)) !== null) {
        const str = match[0];
        result.push(str);
    }

    return result;
}

module.exports = WikiGenerator;

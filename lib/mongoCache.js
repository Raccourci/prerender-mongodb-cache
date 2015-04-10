'use strict';

var MongoClient = require('mongodb').MongoClient
var cheerio = require('cheerio');
var Q = require('q');
var _ = require('lodash');

var mongoUri = process.env.MONGOLAB_URI ||
    process.env.MONGOHQ_URL ||
    'mongodb://localhost/prerender';

var db = Q.denodeify(MongoClient.connect)(mongoUri);
var pages = db.then(function (db) {
    return Q.denodeify(db.collection.bind(db))('pages');
});

module.exports = {
    beforePhantomRequest: function(req, res, next) {
        if (req.method === 'DELETE') {
            cache.del(req.url).then(function () {
                res.send(200, req.url + ' deleted.');
            }).catch(reportAndProceed(next));
        } else if (req.method === 'POST') {
            // Just pass through so that Phantom will render the page
            next();
        } else if (req.method === 'GET') {
            cache.get(req.url).then(function (document) {
                console.log('Serving from cache:', req.url);

                _.each(document.headers, function (value, key) {
                    res.setHeader(key, value);
                });

                res.send(document.statusCode, document.content);
            }).catch(reportAndProceed(next));
        } else {
            res.send(400, 'Only GET, POST and DELETE methods are supported.');
        }
    },

    afterPhantomRequest: function(req, res, next) {
        var original = originalHead(req);
        var overrides = headOverrides(req);
        var head = _.merge({}, original, overrides);

        var document = {
            content: req.prerender.documentHTML,
            statusCode: head.statusCode,
            headers: head.headers,
            originalHead: original,
            overrides: overrides
        };

        cache.set(req.url, document).then(function () {
            console.log('Saved:', req.url);

            _.each(document.headers, function (value, key) {
                res.setHeader(key, value);
            });

            res.send(document.statusCode, document.content);
        }).catch(reportAndProceed(next));
    }
};

function originalHead (req) {
    return {
        statusCode: req.prerender.statusCode,
        headers: req.prerender.headers.reduce(function (headers, header) {
            headers[header.name] = header.value;
            return headers;
        }, {})
    };
}

function headOverrides (req) {
    var $ = cheerio.load(req.prerender.documentHTML);

    var headersOverride = {};

    $('meta[name="prerender-header"][content]').each(function (i, el) {
        var content = el.attribs.content.match(/([^:]+):\s*(.*)\s*/);
        var name = content[1];
        var value = content[2];
        headersOverride[name] = value;
    });

    var overriden = {
        headers: headersOverride
    };

    var statusCodeOverride = $('meta[name="prerender-status-code"][content]')
        .last()
        .attr('content');

    if (statusCodeOverride) {
        overriden.statusCode = parseInt(statusCodeOverride, 10);
    }

    return overriden;
}


var cache = {
    get: function (key) {
        return pages.then(function (collection) {
            var findOne = Q.denodeify(collection.findOne.bind(collection));

            return findOne({ key: key }).then(function (item) {
                return item || Q.reject(key + ' not found');
            });
        });
    },
    set: function (key, value) {
        return pages.then(function (collection) {
            var update = Q.denodeify(collection.update.bind(collection));

            var query = { key: key };
            var options = { upsert: true };

            var document = _.merge({
                key: key,
                created: new Date()
            }, value);

            return update(query, document, options);
        });
    },
    del: function(key) {
        return pages.then(function (collection) {
            var findAndRemove = Q.denodeify(collection.findAndRemove.bind(collection));

            return findAndRemove({ key: key });
        });
    }
};

function reportAndProceed (next) {
    return function (error) {
        console.error(error.stack || error);
        next();
    };
}

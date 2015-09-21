'use strict';

var MongoClient = require('mongodb').MongoClient
var cheerio = require('cheerio');
var Q = require('q');
var _ = require('lodash');

var mongoUri = process.env.MONGOLAB_URI ||
    process.env.MONGOHQ_URL ||
    'mongodb://localhost/prerender';

var db = Q.denodeify(MongoClient.connect)(mongoUri);
var table = function(domain){
    return db.then(function (db) {
        return Q.denodeify(db.collection.bind(db))(domain);
    });
};

module.exports = {
    beforePhantomRequest: function(req, res, next) {
        var uri = uriFromPath(req.url);

        if (req.method === 'DELETE' || req.headers['X-Action'] === 'DELETE') {
            del(uri).then(function () {
                res.send(200, uri + ' deleted.');
            }).catch(reportAndProceed(next));
        } else if (req.method === 'PUT' || req.headers['X-Action'] === 'PUT') {
            // Just pass through so that Phantom will render the page
            next();
        } else if (req.method === 'GET' || req.headers['X-Action'] === 'GET') {
            get(uri).then(function (document) {
                console.log('Serving from cache:', uri);

                _.each(document.headers, function (value, key) {
                    res.setHeader(key, value);
                });

                res.send(document.statusCode, document.content);
            }).catch(reportAndProceed(next));
        } else {
            res.send(400, 'Only GET, PUT and DELETE methods are supported.');
        }
    },

    afterPhantomRequest: function(req, res, next) {
        var uri = uriFromPath(req.url);

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

        set(uri, document).then(function () {
            console.log('Saved:', uri);

            _.each(document.headers, function (value, key) {
                res.setHeader(key, value);
            });

            res.send(document.statusCode, document.content);
        }).catch(reportAndProceed(next));
    }
};

function uriFromPath (path) {
    return path.replace(/^\//, '');
}

function domainFromPath (uri) {
    return uri.replace('http://','').replace('https://','').split(/[/?#]/)[0];
}

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


function get (uri) {
    return table(domainFromPath(uri)).then(function (collection) {
        var findOne = Q.denodeify(collection.findOne.bind(collection));

        return findOne({ uri: uri }).then(function (item) {
            return item || Q.reject(uri + ' not found');
        });
    });
}

function set (uri, value) {
    return table(domainFromPath(uri)).then(function (collection) {
        var update = Q.denodeify(collection.update.bind(collection));

        var query = { uri: uri };
        var options = { upsert: true };

        var document = _.merge({
            uri: uri,
            date: new Date()
        }, value);

        return update(query, document, options);
    });
}

function del (uri) {
    return table(domainFromPath(uri)).then(function (collection) {
        var findAndRemove = Q.denodeify(collection.findAndRemove.bind(collection));

        return findAndRemove({ uri: uri });
    });
}

function reportAndProceed (next) {
    return function (error) {
        console.error(error.stack || error);
        next();
    };
}

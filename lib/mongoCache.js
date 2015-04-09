'use strict';

var MongoClient = require('mongodb').MongoClient
var Q = require('q');

var mongoUri = process.env.MONGOLAB_URI ||
    process.env.MONGOHQ_URL ||
    'mongodb://localhost/prerender';

var db = Q.denodeify(MongoClient.connect)(mongoUri);
var pages = db.then(function (db) {
    return Q.denodeify(db.collection.bind(db))('pages');
});

module.exports = {
    beforePhantomRequest: function(req, res, next) {
        if (req.method === 'POST') {
            cache.del(req.url).then(next, next);
        } else if (req.method === 'GET') {
            cache.get(req.url).then(function (result) {
                console.log('Serving from cache:', req.url);
                res.send(200, result);
            }, function (error) {
                console.error(error.stack || error);
                next();
            });
        } else {
            next();
        }
    },

    afterPhantomRequest: function(req, res, next) {
        cache.set(req.url, req.prerender.documentHTML).then(function () {
            console.log('Saved:', req.url);
            next();
        }, function (error) {
            console.error(error.stack || error);
            next();
        });
    }
};


var cache = {
    get: function(key) {
        return pages.then(function (collection) {
            var findOne = Q.denodeify(collection.findOne.bind(collection));
            return findOne({key: key}).then(function (item) {
                return item ? item.value : null;
            });
        });
    },
    set: function(key, value) {
        return pages.then(function (collection) {
            var update = Q.denodeify(collection.update.bind(collection));

            var query = { key: key };
            var object = { key: key, value: value, created: new Date() };
            var options = { upsert: true };

            return update(query, object, options);
        });
    },
    del: function(key) {
        return pages.then(function (collection) {
            var findAndRemove = Q.denodeify(collection.findAndRemove.bind(collection));
            return findAndRemove({ key: key });
        });
    }
};

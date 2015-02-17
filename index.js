var fs = require('fs'),
    hapi = require('hapi'),
    pg = require('pg'),
    boom = require('boom'),
    pg_copy = require('pg-copy-streams'),
    reformatCsv = require('./lib/reformat-csv');

var user = process.env.DBUsername;
var password = process.env.DBPassword;
var address = process.env.DBAddress;
var database = process.env.Database;

// on RDS, how do I set a security group?
    // or whitelist this instance or something, somehow
    // this must not happen in the main app, probably in install somewhere

var conString = 'postgres://' +
    user + ':' +
    password + '@' +
    address + '/' +
    database;

var server = new hapi.Server();

server.connection({
    host: 'localhost',
    port: 8000
});

server.route({
    method: 'GET',
    path:'/stuff',
    handler: function(request, reply) {
        reply('between the bars');
    }
});

server.route({
    method: 'GET',
    path: '/status',
    handler: function(request, reply) {
        reply('ok');
    }
});

server.route({
    method: 'POST',
    path: '/csv',
    config: {
        payload: {
            maxBytes: 200000000,
            output: 'stream',
            parse: true,
            allow: 'multipart/form-data'
        }
    },
    handler: function(request, reply) {
        var data = request.payload;

        if (data.file) {
            var name = data.file.hapi.filename;

            // just looking at the extension for now
            if (name.slice(-4) != '.csv') {
                return reply(boom.badRequest('.csv files only'));
            }

            var path = (process.env.UploadPath || '/mnt/uploads');
            if (path[path.length-1] !== '/') path = path + '/';

            var file = fs.createWriteStream(path + name);

            file.on('error', function (err) {
                reply(boom.badRequest(err));
            });

            data.file.pipe(file);

            data.file.on('end', function (err) {
                reformatCsv(path, path + name, function(err, filename) {
                    if (err) {
                        fs.unlink(path + name, function() {
                            reply(boom.badRequest(err));
                        });
                    } else {
                        // return reply('successfully uploaded');
                        // COPY to postgres

                        // check if the table already exists
                        // if it doesn't just write it
                            // if it does, create a unique id, keep it there and make a process for renaming the table eventually

                        console.log(conString);

                        pg.connect(conString, function(err, client, done) {
                            if (err) return reply(boom.badRequest(err));

                            client.query('create table if not exists temp (key varchar(255), value text);', function(err, results) {
                                if (err) return reply(boom.badRequest(err));
                            });

                            var stream = client.query(pg_copy.from('COPY temp FROM STDIN (format csv);'));

                            var fileStream = fs.createReadStream(filename);
                            fileStream
                                .on('error', function(err) {
                                    return reply(boom.badRequest(err));
                                })
                                .pipe(stream)
                                    .on('finish', function() {
                                        return reply('ok');
                                    })
                                    .on('error', function(err) {
                                        return reply(boom.badRequest(err));
                                    });

                        });
                    }
                });
            });

        }
    }
});

server.start();

// soooo, we need server side user auth
    // in order to restrict uploads to specific users
    // just use an env var for first pass?
        // require a cooldown
    // every POST must then

// first pass, upload a csv
    // retructure into k/v, hash, full object as string
    // later we can pull special columns, latitude, longitude, _country
        // what does the editor geocoder do? ffforest?

// curl -i -F name=something -F file=@with-cats.csv http://localhost:8000/csv

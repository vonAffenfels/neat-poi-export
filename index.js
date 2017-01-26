"use strict";

var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var Tools = require("neat-base").Tools;
var Promise = require("bluebird");
var fs = require('fs');

var validFormats = [
    "gpx", // done
    "asc",
    "kml",
    "loc",
    "wpt", // maybe
    "xml"
];

// ASC, GPX, KML, LOC, WPT, XML


var contentTypes = {
    gpx: "text/gpx",
    xml: "text/xml"
};

module.exports = class PoiExport extends Module {

    static defaultConfig() {
        return {
            authModuleName: "auth",
            exportRoute: "/poi-export",
            elementsModuleName: "elements",
            webserverModuleName: "webserver",
            dbModuleName: "database",
            dbModelName: "pitch",
            exportFieldsMap: {
                gps: "gps", //[0] = lat [1] = long
                country: "country",
                city: "city",
                zip: "zip",
                street: "street",
                type: "pitchType",
                name: "_de.name",
                createdAt: "_createdAt"
            }
        }
    }

    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");

            if (Application.modules[this.config.webserverModuleName] && this.config.exportRoute) {
                Application.modules[this.config.webserverModuleName].addRoute("post", this.config.exportRoute, (req, res, next) => {
                    this.handleRequest(req, res);
                }, 9999);
            }

            return resolve(this);
        });
    }

    handleRequest(req, res) {

        if(!req.body.format || !req.body.query) {
            return res.status(400).end('no format and/or query given');
        }

        try {
            var model = Application.modules[this.config.dbModuleName].getModel(this.config.dbModelName);
        } catch (e) {
            return res.status(400).end('model "' + this.config.dbModelName + '" does not exist');
        }

        if (Application.modules[this.config.authModuleName]) {
            if (!Application.modules[this.config.authModuleName].hasPermission(req, this.config.dbModelName, "find")) {
                return res.status(401).end();
            }
        }

        var format = req.body.format.toLowerCase();
        var query = req.body.query.query || {};
        var limit = req.body.query.limit || 10;
        var page = req.body.query.page || 0;
        var sort = req.body.query.sort || {"_createdAt": -1};

        if(validFormats.indexOf(format) === -1) {
            return res.status(400).end('invalid format "'+ format +'". Valid formats are: ' + validFormats.join(', '));
        }

        ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
        this.config.exportFields = [];

        for(var key in this.config.exportFieldsMap) {
            this.config.exportFields.push(this.config.exportFieldsMap[key]);
        }

        var dbQuery = model.find(query, this.config.exportFields.join(" ")).limit(limit).skip(limit * page).sort(sort);

        dbQuery.exec().then((docs) => {

            this.validatePOIs(docs).then((validPOIs) => {

                this.exportPOIs(format, validPOIs, res);

            }, (err) => {
                res.err(err);
            })

        }, (err) => {
            res.err(err);
        });

    }

    validatePOIs(docs) {
        return new Promise((resolve, reject) => {
            var validPOIs = [];

            for(var i = 0; i<docs.length; i++) {
                var POI = docs[i];
                var skip = false;

                var tempObj = {};
                for(var key in this.config.exportFieldsMap) {
                    var field = this.config.exportFieldsMap[key];

                    if(!POI.get(field)) {
                        skip = true;
                        break;
                    } else {
                        tempObj[key] = POI.get(field);
                    }
                }

                if(!skip) {
                    validPOIs.push(tempObj);
                }
            }

            resolve(validPOIs);
        });
    }

    exportPOIs(format, POIs, res) {

        var fileData = this.getMainFileDataForFormat(format);
        var fileName = "POI-EXPORT-DEFAULT";
        var waypoints = "";

        res.setHeader("content-type", contentTypes[format]);
        res.setHeader("Content-Disposition", "attachment;filename="+ fileName + "." + format);

        for(var i = 0; i<POIs.length; i++) {
            waypoints += this.createWaypoint(format,POIs[i]);
        }

        fileData = fileData.replace("{{POIDATA}}",waypoints);
        res.send(fileData);
    }


    getMainFileDataForFormat(format) {
        switch(format) {
            case "gpx":
                return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>' +
                    '<gpx version="1.1" creator="Neat POI Export"><metadata>' +
                    '<author><name>Neat POI Export</name></author></metadata>' +
                    '{{POIDATA}}' +
                    '</gpx>';
                break;
            case "xml":
                return '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:gml="http://www.opengis.net/gml" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:georss="http://www.georss.org/georss" xmlns:taxo="http://purl.org/rss/1.0/modules/taxonomy/" version="2.0">' +
                    '<channel>' +
                    '<title>Neat POI Export</title>' +
                    '</channel>' +
                    '{{POIDATA}}' +
                    '</rss>';
                break;
        }
    }

    createWaypoint(format, POI) {

        var waypoint = "";

        switch(format) {
            case "gpx":
                waypoint = '<wpt lat="'+ POI.gps[0] +'" lon="'+ POI.gps[1] +'"><name>'+ POI.name +'</name><time>' + POI.createdAt + '</time><sym>RV Park (Outdoors)</sym></wpt>';
                break;
            case "xml":
                waypoint = '<item>'+ POI.name +'<title><georss:point>'+ POI.gps[0] +' '+ POI.gps[1] +'</georss:point></title></item>';
                break;
        }

        return waypoint;
    }

};

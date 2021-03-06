"use strict";
const express = require("express");
const merge = require("merge");
const router = express.Router();
const Promise = require("promise");
const config = require("./fortnite.config.js");
const utils = require("../../lib/utils");
const FortniteApi = require("../../lib/gamestats").fortnite;
const async = require("async");

const filteredFields = ["score", "score_", "scorepermatch", "scorepermatch_", "scoreperminute", "scoreperminute_", "trnrating", "trnrating_"];
let _cleanField = s => {
	return s
		.replace(/[\s\/]/gi, "")
		.replace(/%/i, "s_")
		.replace(/\s?%/i, "_")
		.replace(/(\d)s/i, "$1")
		.toLowerCase();
};

let _cleanLabel = s => {
	return s
		.replace(/(\d)s/i, "$1")
		.replace(/^win%$/i, "Wins %")
		.replace(/^matches played$/i, "Matches");
};
let _cleanNumber = s => {
	if(/\d[mdhs]|[a-z]/ig.test(s)) {
		return s;
	}
	return parseFloat(s.toString().replace(/,/i, ""));
}


let _transformArrayStats = (input, fields) => {
	return new Promise((resolve, reject) => {
		let data = [];
		let added = [];
		for (let x = 0; x < input.length; ++x) {
			let item = input[x];
			let fieldName = _cleanField(item.key);
			let itemValue = _cleanNumber(item.value);
			if (utils.array.hasValue(filteredFields, fieldName) || (itemValue === 0 && utils.array.hasValue(fields, "*"))) {
				continue;
			}
			if (config.fortnite.LABEL_TO_FIELD[fieldName]) {
				fieldName = config.fortnite.LABEL_TO_FIELD[fieldName];
			}
			let winIndex = null;
			if (!utils.array.hasValue(added, "wins_")) {
				for (let f = 0; f < data.length; ++f) {
					if (data[f].field === "wins") {
						winIndex = f + 1;
						break;
					}
				}
			}

			/*** START: This is ugly, but merges duplicate fields***/
			let existingItemIndex = null;
			let filtered = data.filter((v, i) => {
				if(v.field === fieldName) {
					existingItemIndex = i;
				}
				return v.field === fieldName;
			});
			if (filtered.length === 1) {
				console.log("add " + filtered[0].value + " + " + item.value);
				console.log("index: " + existingItemIndex);
				itemValue = _cleanNumber(filtered[0].value) + _cleanNumber(item.value);
				if(existingItemIndex >= 0) {
					data.splice(existingItemIndex, 1);
				}
				let addedIndex = added.indexOf(fieldName);
				if(addedIndex >= 0) {
					added.splice(addedIndex, 1);
				}
			}
			/*** END: UGLY ***/

			if (
				!utils.array.hasValue(added, fieldName) &&
				(utils.array.hasValue(fields, fieldName) || utils.array.hasValue(fields, "*"))
			) {
				let postFix = "";
				if (fieldName.endsWith("_")) {
					postFix = "%";
				}
				added.push(fieldName);
				let aitem = {
					field: fieldName,
					label: _cleanLabel(item.key),
					value: itemValue,
					display: itemValue.toLocaleString() + postFix
				};
				data.splice(winIndex ? winIndex : 0, 0, aitem);
			}
		}

		return resolve(data);
	});
};

let _transformObjectStats = (input, fields) => {
	return new Promise((resolve, reject) => {
		try {
			let data = [];
			let added = [];
			for (let f in input) {
				if (input.hasOwnProperty(f)) {
					let item = input[f];
					let fieldName = _cleanField(item.label);
					if (config.fortnite.LABEL_TO_FIELD[fieldName]) {
						fieldName = config.fortnite.LABEL_TO_FIELD[fieldName];
					}
					let itemValue = _cleanNumber(item.value);
					if (utils.array.hasValue(filteredFields, fieldName) || (itemValue === 0 && utils.array.hasValue(fields, "*"))) {
						continue;
					}

					if (
						(utils.array.hasValue(fields, fieldName) || utils.array.hasValue(fields, "*")) &&
						!utils.array.hasValue(added, fieldName) &&
						!fieldName.endsWith("_")
					) {
						added.push(fieldName);
						data.splice(0, 0, {
							field: fieldName,
							label: item.label,
							value: itemValue,
							display: _cleanNumber(item.displayValue || item.value).toLocaleString()
						});
					}
					if (
						item.percentile &&
						!utils.array.hasValue(added, `${fieldName}_`) &&
						!fieldName.endsWith("_") &&
						(utils.array.hasValue(fields, `${fieldName}_`) || utils.array.hasValue(fields, "*"))
					) {
						let fieldIndex = null;
						if (utils.array.hasValue(fields, `${fieldName}_`)) {
							for (let f = 0; f < data.length; ++f) {
								if (data[f].field === fieldName) {
									fieldIndex = f + 1;
									break;
								}
							}
						}
						added.push(`${fieldName}_`);
						data.splice(fieldIndex ? fieldIndex : 0, 0, {
							field: `${fieldName}_`,
							label: `${item.label} %`,
							value: item.percentile,
							display: `${item.percentile}%`
						});
					}
				}
			}
			if (utils.array.hasValue(fields, "*")) {
				console.log("sort");
				data.sort(function(a, b) {
					if (a.field < b.field) {
						return -1;
					}
					if (a.field > b.field) {
						return 1;
					}
					return 0;
				});
			}
			return resolve(data);
		} catch (err) {
			return reject(err);
		}
	});
};

/* GET home page. */
router.get("/:platform/:username/:mode?", (req, res, next) => {
	let settings = {
		API_KEY: config.fortnite.API_KEY
	};
	let server = new FortniteApi(settings);
	let fields = (req.query.fields || "*").split(/,|\||;/i);
	server
		.stats(req.params.platform, req.params.username)
		.then(body => {
			if (!body || body.error) {
				return res.status(500).send(body.error || "Unknown Error");
			}
			let mode = req.params.mode || "all";
			if (mode === "all") {
				let data = body[config.fortnite.MODES[mode]];
				_transformArrayStats(data, fields)
					.then(data => {
						return res.json(data);
					})
					.catch(err => {
						return res.status(500).send(err.message);
					});
			} else {
				let source = body.stats[config.fortnite.MODES[mode]];
				if (!source) {
					return res.json([]);
				} else {
					_transformObjectStats(source, fields)
						.then(data => {
							return res.json(data);
						})
						.catch(err => {
							return res.status(500).send(err.message);
						});
				}
			}
		})
		.catch(err => {
			if (err) {
				return res.status(500).send(err.message);
			}
			return next();
		});
});

/* GET home page. */
router.get("/raw/:platform/:username/:mode?", (req, res, next) => {
	let settings = {
		API_KEY: config.fortnite.API_KEY
	};
	let server = new FortniteApi(settings);
	server
		.stats(req.params.platform, req.params.username)
		.then(body => {
			if (!body || body.error) {
				return res.status(500).send(body.error || "Unknown Error");
			}
			let mode = req.params.mode || "all";
			if (mode === "all") {
				let data = body[config.fortnite.MODES[mode]];
				return res.json(data);
			} else {
				let source = body.stats[config.fortnite.MODES[mode]];
				if (!source) {
					return res.json([]);
				} else {
					return res.json(source);
				}
			}
		})
		.catch(err => {
			if (err) {
				return res.status(500).send(err.message);
			}
			return next();
		});
});
module.exports = router;

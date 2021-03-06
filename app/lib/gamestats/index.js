"use strict";

let outObject = {};
const fs = require("fs");
const path = require("path");
const normalizedPath = path.join(__dirname, "./");

let _processPath = p => {
	fs.readdirSync(p).forEach(file => {
		try {
			let configMatch = /.*?\.config\.js/i;
			let deepPath = p.substring(normalizedPath.length).replace(/\\/g, "/");
			let fullPath = path.join(p, file);
			if (fs.lstatSync(fullPath).isDirectory()) {
				_processPath(fullPath);
			} else {
				if (
					file !== "index.js" &&
					file !== "config.js" &&
					!configMatch.test(file)
				) {
					let name = file.substring(0, file.lastIndexOf("."));
					let p1 = deepPath.length > 0 ? `${deepPath}/` : "";
					outObject[`${p1}${name}`] = require(`./${p1}${name}`);
				}
			}
		} catch (ex) {
			console.error(ex);
		}
	});
};

_processPath(normalizedPath);

module.exports = outObject;

/**
 * hive.js
 * Copyright (C) 2013-2015 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var co = require('co')
  , through = require('through2')
  , JSONParse = require('json-stream')
  , path = require('path')

module.exports = setup
module.exports.consumes = ['ui', 'broadcast', 'orm']

function setup(plugin, imports, register) {
  var ui = imports.ui
    , broadcast = imports.broadcast
    , orm = imports.orm

  ui.registerModule(path.join(__dirname, 'client.js'))

  var cursors = {}

  broadcast.registerChannel(new Buffer('codemirror-cursors'), function(user, document, client, brdcst) {
    co(function*() {
      if((yield orm.collections.document.findOne(document)).type !== 'text/plain') return
      if(!cursors[document]) cursors[document] = {}

      var writeAll

      client
      .pipe(JSONParse())
      .pipe(through.obj(function(myCursor, enc, callback) {
	cursors[document][user.id] = myCursor
	var obj = {}
	obj[user.id] = myCursor
	this.push(obj)
	callback()
      }))
      .pipe(writeAll = JSONStringify())
      .pipe(brdcst)
      .pipe(JSONParse())
      .pipe(through.obj(function(broadcastCursors, enc, callback) {
	for(var userId in broadcastCursors) {
	  cursors[document][userId] = broadcastCursors[userId]
	}
	this.push(broadcastCursors)
	callback()
      }))
      .pipe(JSONStringify())
      .pipe(client)

      client.on('close', function() {
        writeAll.write({[user.id]: null})
        cursors[document][user.id] = null
      })

      client.write(JSON.stringify(cursors[document])+'\n')
    })
  })  

  register()
}

function JSONStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}

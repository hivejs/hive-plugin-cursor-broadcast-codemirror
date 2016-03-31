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

var vdom = require('virtual-dom')
  , h = vdom.h
  , jsonParse = require('json-stream')
  , through = require('through2')

const UPDATE_CURSORS = 'CURSORBROADCASTCODEMIRROR_UPDATE_CURSORS'

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'presence']
module.exports.provides = ['cursorBroadcastCodemirror']
function setup(plugin, imports, register) {
  var ui = imports.ui
    , editor = imports.editor

  ui.reduxReducerMap.cursorBroadcastCodemirror = reducer
  function reducer(state, action) {
    if(!state) {
      return {
        cursors: {}
      }
    }
    if(UPDATE_CURSORS === action.type) {
      var newState = {...state, cursors: {...state.cursors, ...action.payload}}
      for(var userId in newState.cursors) {
        if(!newState.cursors[userId]) delete newState.cursors[userId]
      }
      return newState
    }
    return state
  }

  var cursorBroadcast = {
    action_updateCursors: function(cursors) {
      return {type: UPDATE_CURSORS, payload: cursors}
    }
  , stream: null
  , markers: []
  }

  editor.onLoad((editableDocument, broadcast, onClose) => {
    // This plugin works with ckeditor only
    if(ui.store.getState().editor.editor !== 'CodeMirror') return

    var lastCursors
    var dispose = ui.store.subscribe(function() {
      var state = ui.store.getState()
        , cursors = state.cursorBroadcastCodemirror.cursors
        , currentAuthor = state.session.user.id

      if(cursors === lastCursors) return
      lastCursors = cursors

      // remove the old markers
      cursorBroadcast.markers.forEach((marker) => {
        marker.clear()
      })

      // add the new markers
      Object.keys(cursors)
      //.filter((authorId) => authorId !== currentAuthor)
      .filter((authorId) => !!state.presence.users[authorId])
      .forEach((authorId) => {
         cursorBroadcast.markers = cursorBroadcast.markers.concat(
           cursors[authorId].map((sel) => {
             var user = state.presence.users[authorId]
               , empty = (sel.anchor.line === sel.head.line && sel.anchor.ch === sel.head.ch)
             if(empty) {
	       return editableDocument.codemirror.markText(sel.anchor, sel.head, {
		 clearWhenEmpty: false
	       , replacedWith: vdom.create(h('span', {
                   title: user.attributes.name
                 , style: {
                     border:'2px solid '+(user.attributes.color || '#777')
                   , position: 'absolute'
                   , width: '0'
                   }
                 }, ' '))
               })
             }else{
               return editableDocument.codemirror.markText(sel.anchor, sel.head, {
                 title: user.attributes.name
               , clearWhenEmpty: false
               , css: 'border: 2px solid '+(user.attributes.color || '#777')
               })
             }
          })
        )
      })
    })

    cursorBroadcast.stream = broadcast.createDuplexStream(new Buffer('codemirror-cursors'))

    // As soon as doc is initialized, listen on broadcast
    editableDocument.on('init', function() {
      cursorBroadcast.stream
      .pipe(jsonParse())
      .pipe(through.obj(function(cursors, enc, cb) {
        // update
        ui.store.dispatch(cursorBroadcast.action_updateCursors(cursors))
        cb()
      }))
    })

    editableDocument.codemirror.on("cursorActivity", collectCursor)
    function collectCursor() {
      var sel = editableDocument.codemirror.listSelections()
      cursorBroadcast.stream.write(JSON.stringify(sel)+'\n')
    }

    onClose(_=> {
      dispose()
      editableDocument.codemirror.off('cursorActivity', collectCursor)
    })
  })

  register(null, {cursorBroadcastCodemirror: cursorBroadcast})
}

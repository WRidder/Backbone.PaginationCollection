"use strict";

// Dependencies
var _ = require("underscore");
var Backbone = require("backbone");

// Helper functions
var _extend = _.extend;
var _omit = _.omit;
var _clone = _.clone;
var _each = _.each;
var _keys = _.keys;
var _isUndefined = _.isUndefined;
var ceil = Math.ceil;
var floor = Math.floor;
var max = Math.max;
var BBColProto = Backbone.Collection.prototype;

// Helper functions
function finiteInt (val, name) {
	if (!_.isNumber(val) || _.isNaN(val) || !_.isFinite(val) || Math.floor(val) !== val) {
		throw new TypeError("`" + name + "` must be a finite integer");
	}
	return val;
}

// hack to make sure the whatever event handlers for this event is run
// before func is, and the event handlers that func will trigger.
function runOnceAtLastHandler (col, event, func) {
	var eventHandlers = col._events[event];
	if (eventHandlers && eventHandlers.length) {
		var lastHandler = eventHandlers[eventHandlers.length - 1];
		var oldCallback = lastHandler.callback;
		lastHandler.callback = function () {
			try {
				oldCallback.apply(this, arguments);
				func();
			}
			catch (e) {
				throw e;
			}
			finally {
				lastHandler.callback = oldCallback;
			}
		};
	}
	else {
		func();
	}
}

/**
 Drop-in replacement for Backbone.Collection. Supports client-side pagination and sorting.
 Client-side mode also support fully multi-directional synchronization of changes between pages.
 @class Backbone.PaginationCollection
 @extends Backbone.Collection
 */
var PaginationCollection = Backbone.PaginationCollection = Backbone.Collection.extend({

	/**
	 The container object to store all pagination states.
	 You can override the default state by extending this class or specifying
	 them in an `options` hash to the constructor.
	 @property {Object} state
	 @property {0|1} [state.firstPage=1] The first page index. Set to 0 if
	 your server API uses 0-based indices. You should only override this value
	 during extension, initialization or reset by the server after
	 fetching. This value should be read only at other times.
	 @property {number} [state.lastPage=null] The last page index. This value
	 is __read only__ and it's calculated based on whether `firstPage` is 0 or
	 1, during bootstrapping, fetching and resetting. Please don't change this
	 value under any circumstances.
	 @property {number} [state.currentPage=null] The current page index. You
	 should only override this value during extension, initialization or reset
	 by the server after fetching. This value should be read only at other
	 times. Can be a 0-based or 1-based index, depending on whether
	 `firstPage` is 0 or 1. If left as default, it will be set to `firstPage`
	 on initialization.
	 @property {number} [state.pageSize=25] How many records to show per
	 page. This value is __read only__ after initialization, if you want to
	 change the page size after initialization, you must call #setPageSize.
	 @property {number} [state.totalPages=null] How many pages there are. This
	 value is __read only__ and it is calculated from `totalRecords`.
	 @property {number} [state.totalRecords=null] How many records there
	 are. This value is __required__ under server mode. This value is optional
	 for client mode as the number will be the same as the number of models
	 during bootstrapping and during fetching, either supplied by the server
	 in the metadata, or calculated from the size of the response.
	 @property {string} [state.sortKey=null] The model attribute to use for
	 sorting.
	 @property {-1|0|1} [state.order=-1] The order to use for sorting. Specify
	 -1 for ascending order or 1 for descending order. If 0, no client side
	 sorting will be done and the order query parameter will not be sent to
	 the server during a fetch.
	 */
	state: {
		firstPage: 1,
		lastPage: null,
		currentPage: null,
		pageSize: 25,
		totalPages: null,
		totalRecords: null,
		sortKey: null,
		order: -1
	},

	/**
	 Given a list of models or model attributues, bootstraps the full
	 collection in client mode or infinite mode, or just the page you want in
	 server mode.
	 If you want to initialize a collection to a different state than the
	 default, you can specify them in `options.state`. Any state parameters
	 supplied will be merged with the default. If you want to change the
	 default mapping from #state keys to your server API's query parameter
	 names, you can specifiy an object hash in `option.queryParams`. Likewise,
	 any mapping provided will be merged with the default. Lastly, all
	 Backbone.Collection constructor options are also accepted.
	 See:
	 - Backbone.PageableCollection#state
	 - Backbone.PageableCollection#queryParams
	 - [Backbone.Collection#initialize](http://backbonejs.org/#Collection-constructor)
	 @param {Backbone.Collection} [collection]
	 @param {Object} [options]
	 @param {function(*, *): number} [options.comparator] If specified, this
	 comparator is set to the current page under server mode, or the #fullCollection
	 otherwise.
	 @param {boolean} [options.full] If `false` and either a
	 `options.comparator` or `sortKey` is defined, the comparator is attached
	 to the current page. Default is `true` under client or infinite mode and
	 the comparator will be attached to the #fullCollection.
	 @param {Object} [options.state] The state attributes overriding the defaults.
	 @param {string} [options.state.sortKey] The model attribute to use for
	 sorting. If specified instead of `options.comparator`, a comparator will
	 be automatically created using this value, and optionally a sorting order
	 specified in `options.state.order`. The comparator is then attached to
	 the new collection instance.
	 @param {-1|1} [options.state.order] The order to use for sorting. Specify
	 -1 for ascending order and 1 for descending order.
	 @param {Object} [options.queryParam]
	 */
	constructor: function (collection, options) {
		BBColProto.constructor.apply(this, [[], options]);
		options = options || {};
		this.fullCollection = collection;

		// Merge state with defaults
		var state = this.state = _extend({}, PageableProto.state, this.state,
			options.state || {});

		// Set current page
		state.currentPage = state.currentPage === null ?	state.firstPage :	state.currentPage;

		// Count models
		state.totalRecords = collection.models.length;

		// Connect this and full collection
		this.bindEvents();

		// Get initial page
		this.getPage(state.currentPage);

		// Save initial state
		this._initState = _clone(this.state);
	},

	/**
	 Sanity check this collection's pagination states. Only perform checks
	 when all the required pagination state values are defined and not null.
	 If `totalPages` is undefined or null, it is set to `totalRecords` /
	 `pageSize`. `lastPage` is set according to whether `firstPage` is 0 or 1
	 when no error occurs.
	 @private
	 @throws {TypeError} If `totalRecords`, `pageSize`, `currentPage` or
	 `firstPage` is not a finite integer.
	 @throws {RangeError} If `pageSize`, `currentPage` or `firstPage` is out
	 of bounds.
	 @return {Object} Returns the `state` object if no error was found.
	 */
	_checkState: function (state) {
		var totalRecords = state.totalRecords;
		var pageSize = state.pageSize;
		var currentPage = state.currentPage;
		var firstPage = state.firstPage;
		var totalPages = state.totalPages;

		if (totalRecords !== null && pageSize !== null && currentPage !== null && firstPage !== null) {
			totalRecords = finiteInt(totalRecords, "totalRecords");
			pageSize = finiteInt(pageSize, "pageSize");
			currentPage = finiteInt(currentPage, "currentPage");
			firstPage = finiteInt(firstPage, "firstPage");

			if (pageSize < 1) {
				throw new RangeError("`pageSize` must be >= 1");
			}
			totalPages = state.totalPages = ceil(totalRecords / pageSize);
			if (firstPage < 0 || firstPage > 1) {
				throw new RangeError("`firstPage must be 0 or 1`");
			}
			state.lastPage = firstPage === 0 ? max(0, totalPages - 1) : totalPages || firstPage;

			if (currentPage < firstPage || (totalPages > 0 &&
				(firstPage ? currentPage > totalPages : currentPage >= totalPages))) {
				throw new RangeError("`currentPage` must be firstPage <= currentPage " +
				(firstPage ? ">" : ">=") +
				" totalPages if " + firstPage + "-based. Got " +
				currentPage + '.');
			}
		}
		return state;
	},

	/**
	 Factory method that returns a Backbone event handler that responses to
	 the `add`, `remove`, `reset`, and the `sort` events. The returned event
	 handler will synchronize the current page collection and the full
	 collection's models.
	 @private
	 @param {Backbone.PageableCollection} pageCol
	 @param {Backbone.Collection} fullCol
	 @return {function(string, Backbone.Model, Backbone.Collection, Object)}
	 Collection event handler
	 */
	_makeCollectionEventHandler: function (pageCol, fullCol) {
		return function collectionEventHandler (event, model, collection, options) {
			options = options || {};

			// Unbind handlers
			var handlers = pageCol._handlers;
			_each(_keys(handlers), function (event) {
				var handler = handlers[event];
				pageCol.off(event, handler);
				fullCol.off(event, handler);
			});

			// Get current state
			var state = _clone(pageCol.state);
			var firstPage = state.firstPage;
			var currentPage = firstPage === 0 ?	state.currentPage : state.currentPage - 1;
			var pageSize = state.pageSize;
			var pageStart = currentPage * pageSize;
			var pageEnd = pageStart + pageSize;

			// Add event
			if (event === "add") {
				var pageIndex, fullIndex, addAt, colToAdd;

				// Model is added to the source (full)collection
				if (collection === fullCol) {
					fullIndex = fullCol.indexOf(model);
					if (fullIndex >= pageStart && fullIndex < pageEnd) {
						colToAdd = pageCol;
						pageIndex = addAt = fullIndex - pageStart;
					}
				}
				// Model is added to the PaginationCollection
				else {
					pageIndex = pageCol.indexOf(model);
					fullIndex = pageStart + pageIndex;
					colToAdd = fullCol;
					addAt = !_isUndefined(options.at) ?
					options.at + pageStart :
						fullIndex;
				}
				if (!options.onRemove) {
					++state.totalRecords;
					delete options.onRemove;
				}
				pageCol.state = pageCol._checkState(state);
				if (colToAdd) {
					colToAdd.add(model, _extend({}, options || {}, {at: addAt}));
					var modelToRemove;
					if (pageIndex >= pageSize) {
						modelToRemove = model;
					}
					else {
						if (!_isUndefined(options.at) && addAt < pageEnd && pageCol.length > pageSize) {
							modelToRemove = pageCol.at(pageSize);
						}
						else {
							modelToRemove = null;
						}
					}

					// If there is a model to remove
					if (modelToRemove) {
						runOnceAtLastHandler(collection, event, function () {
							pageCol.remove(modelToRemove, {onAdd: true});
						});
					}
				}
			}

			// Remove event; remove the model from the other collection as well
			if (event === "remove") {
				if (!options.onAdd) {
					// decrement totalRecords and update totalPages and lastPage
					if (!--state.totalRecords) {
						state.totalRecords = null;
						state.totalPages = null;
					}
					else {
						var totalPages = state.totalPages = ceil(state.totalRecords / pageSize);
						state.lastPage = firstPage === 0 ? totalPages - 1 : totalPages || firstPage;
						if (state.currentPage > state.lastPage) {
							state.currentPage = state.lastPage;
						}
					}
					pageCol.state = pageCol._checkState(state);

					var nextModel;
					var removedIndex = options.index;
					if (collection === pageCol) {
						nextModel = fullCol.at(pageEnd);
						if (nextModel) {
							runOnceAtLastHandler(pageCol, event, function () {
								pageCol.push(nextModel, {onRemove: true});
							});
						}
						else if (!pageCol.length && state.totalRecords) {
							pageCol.reset(fullCol.models.slice(pageStart - pageSize, pageEnd - pageSize),
								_extend({}, options, {parse: false}));
						}
						fullCol.remove(model);
					}
					else if (removedIndex >= pageStart && removedIndex < pageEnd) {
						nextModel = fullCol.at(pageEnd - 1);
						if (nextModel) {
							runOnceAtLastHandler(pageCol, event, function() {
								pageCol.push(nextModel, {onRemove: true});
							});
						}
						pageCol.remove(model);
						if (!pageCol.length && state.totalRecords) {
							pageCol.reset(fullCol.models.slice(pageStart - pageSize, pageEnd - pageSize),
								_extend({}, options, {parse: false}));
						}
					}
				}
				else {
					delete options.onAdd;
				}
			}

			// Reset event
			if (event === "reset") {
				options = collection;
				collection = model;

				// Reset that's not a result of getPage
				if (collection === pageCol && options.from === null && options.to === null) {
					var head = fullCol.models.slice(0, pageStart);
					var tail = fullCol.models.slice(pageStart + pageCol.models.length);
					fullCol.reset(head.concat(pageCol.models).concat(tail), options);
				}
				else if (collection === fullCol) {
					if (!(state.totalRecords = fullCol.models.length)) {
						state.totalRecords = null;
						state.totalPages = null;
					}

					state.lastPage = state.currentPage = state.firstPage;
					pageCol.state = pageCol._checkState(state);
					pageCol.reset(fullCol.models.slice(pageStart, pageEnd),
						_extend({}, options, {parse: false}));
				}
			}

			// Sort event
			if (event === "sort") {
				options = collection;
				collection = model;
				if (collection === fullCol) {
					pageCol.reset(fullCol.models.slice(pageStart, pageEnd),
						_extend({}, options, {parse: false}));
				}
			}

			// Rebind handlers
			_each(_keys(handlers), function (event) {
				var handler = handlers[event];
				_each([pageCol, fullCol], function (col) {
					col.on(event, handler);
					var callbacks = col._events[event] || [];
					callbacks.unshift(callbacks.pop());
				});
			});
		};
	},


	/*
	 * Bind events between the source (full) collection and pagination collection.
	 * @chainable
	 * @return {Backbone.PaginationCollection} this.
	*/
	bindEvents: function () {
		var self = this;
		var fullCollection = this.fullCollection;
		var handlers = this._handlers = this._handlers || {}, handler;

		// Bind add, remove, reset and sort events
		var allHandler = this._makeCollectionEventHandler(this, fullCollection);
		_each(["add", "remove"/*, "reset", "sort"*/], function (event) {
			handlers[event] = handler = _.bind(allHandler, {}, event);
			self.on(event, handler);
			fullCollection.on(event, handler);
		});
		return this;
	},

	/**
	 Change the page size of this collection.
	 Under most if not all circumstances, you should call this method to
	 change the page size of a pageable collection because it will keep the
	 pagination state sane. By default, the method will recalculate the
	 current page number to one that will retain the current page's models
	 when increasing the page size. When decreasing the page size, this method
	 will retain the last models to the current page that will fit into the
	 smaller page size.
	 If `options.first` is true, changing the page size will also reset the
	 current page back to the first page instead of trying to be smart.
	 For server mode operations, changing the page size will trigger a #fetch
	 and subsequently a `reset` event.
	 For client mode operations, changing the page size will `reset` the
	 current page by recalculating the current page boundary on the client
	 side.
	 If `options.fetch` is true, a fetch can be forced if the collection is in
	 client mode.
	 @param {number} pageSize The new page size to set to #state.
	 @param {Object} [options] {@link #fetch} options.
	 @param {boolean} [options.first=false] Reset the current page number to
	 the first page if `true`.
	 @param {boolean} [options.fetch] If `true`, force a fetch in client mode.
	 @throws {TypeError} If `pageSize` is not a finite integer.
	 @throws {RangeError} If `pageSize` is less than 1.
	 @chainable
	 @return {XMLHttpRequest|Backbone.PageableCollection} The XMLHttpRequest
	 from fetch or this.
	 */
	setPageSize: function (pageSize, options) {
		pageSize = finiteInt(pageSize, "pageSize");
		options = options || {first: false};
		var state = this.state;
		var totalPages = ceil(state.totalRecords / pageSize);
		var currentPage = totalPages ?
			max(state.firstPage, floor(totalPages * state.currentPage / state.totalPages)) :
			state.firstPage;
		state = this.state = this._checkState(_extend({}, state, {
			pageSize: pageSize,
			currentPage: options.first ? state.firstPage : currentPage,
			totalPages: totalPages
		}));
		return this.getPage(state.currentPage, _omit(options, ["first"]));
	},

	/**
	 @return {boolean} `true` if this collection can page backward, `false`
	 otherwise.
	 */
	hasPreviousPage: function () {
		var state = this.state;
		var currentPage = state.currentPage;
		return currentPage > state.firstPage;
	},

	/**
	 @return {boolean} `true` if this collection can page forward, `false`
	 otherwise.
	 */
	hasNextPage: function () {
		var state = this.state;
		var currentPage = this.state.currentPage;
		return currentPage < state.lastPage;
	},

	/**
	 Reset the current page of this collection to the first page.
	 @param {Object} options {@link #getPage} options.
	 @chainable
	 @return {Backbone.PageableCollection} this.
	 */
	getFirstPage: function (options) {
		return this.getPage("first", options);
	},

	/**
	 Reset the current page of this collection to the previous page.
	 @param {Object} options {@link #getPage} options.
	 @chainable
	 @return {Backbone.PageableCollection} this.
	 */
	getPreviousPage: function (options) {
		return this.getPage("prev", options);
	},

	/**
	 reset the current page of this collection to the next page.
	 @param {Object} options {@link #getPage} options.
	 @chainable
	 @return {Backbone.PaginationCollection} this.
	 */
	getNextPage: function (options) {
		return this.getPage("next", options);
	},

	/**
	 Reset the current page of this collection to the last page.
	 @param {Object} options {@link #getPage} options.
	 @chainable
	 @return {Backbone.PageableCollection} this.
	 */
	getLastPage: function (options) {
		return this.getPage("last", options);
	},

	/**
	 Given a page index, set #state.currentPage to that index. Reset the current page
	 of this collection to the page specified by `index`.

	 @param {number|string} index The page index to go to.
	 @param {object} options.
	 @throws {TypeError} If `index` is not a finite integer.
	 @throws {RangeError} If `index` is out of bounds.
	 @chainable
	 @return {Backbone.PageableCollection} this.
	 */
	getPage: function (index, options) {
		options = options || {};
	  var fullCollection = this.fullCollection;

		var state = this.state,
			firstPage = state.firstPage,
			currentPage = state.currentPage,
			lastPage = state.lastPage,
			pageSize = state.pageSize;
		var pageNum = index;
		switch (index) {
			case "first": pageNum = firstPage; break;
			case "prev": pageNum = currentPage - 1; break;
			case "next": pageNum = currentPage + 1; break;
			case "last": pageNum = lastPage; break;
			default: pageNum = finiteInt(index, "index");
		}
		this.state = this._checkState(_extend({}, state, {currentPage: pageNum}));
		options.from = currentPage;
		options.to = pageNum;
		var pageStart = (firstPage === 0 ? pageNum : pageNum - 1) * pageSize;

		// Get current page models
		var pageModels = fullCollection && fullCollection.length ?
			fullCollection.models.slice(pageStart, pageStart + pageSize) :
			[];

		// Set current page's models
		this.reset(pageModels, _omit(options, "fetch"));

		return this;
	},

	/**
	 Reset the current page of this collection to the page for the provided item offset.
	 @param {Object} options {@link #getPage} options.
	 @chainable
	 @return {Backbone.PageableCollection} this.
	 */
	getPageByOffset: function (offset, options) {
		if (offset < 0) {
			throw new RangeError("`offset must be > 0`");
		}
		offset = finiteInt(offset);
		var page = floor(offset / this.state.pageSize);
		if (this.state.firstPage !== 0) {
			page++;
		}
		if (page > this.state.lastPage) {
			page = this.state.lastPage;
		}
		return this.getPage(page, options);
	}
});

var PageableProto = PaginationCollection.prototype;
module.exports = PaginationCollection;
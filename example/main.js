var subjects=['I','You','Bob','John','Sue','Kate','The lizard people', 'Titanic'];
var verbs=['will search for','will get','will find','attained','found','will','will accept','accepted'];
var objects=['Billy','an apple','a Triforce','the treasure','a sheet of paper'];
var endings=['.',', right?','.',', like I said.','.',', oh noes!'];

function generateTitle() {
	return subjects[Math.round(Math.random()*(subjects.length-1))]+' '+verbs[Math.round(Math.random()*(verbs.length-1))]+' '+objects[Math.round(Math.random()*(objects.length-1))]+endings[Math.round(Math.random()*(endings.length-1))];
}

var idCount = 1;
function generateModel(showVirtual) {
	return {
		id: idCount++,
		title: generateTitle(),
		showVirtual: (typeof showVirtual !== 'undefined') ? showVirtual : (Math.random() > 0.5)
	};
}

function generateModels(amount) {
	var modelArray = [];
	for (var i = 0; i < amount; i++) {
		modelArray.push(generateModel());
	}
	return modelArray;
}

// Define a collection
var baseCollection = new Backbone.Collection(generateModels(15), {
	comparator: "id"
});

var virtualCollection = new VirtualCollection(baseCollection, {
	comparator: "id",
	filter: {
		showVirtual: true
	}
});

// Itemview
var movieItemView = Marionette.ItemView.extend({
	tagName: "li",
	className: 'listItem',
	template: "#movie-list-item",
	modelEvents: {
		"change": "render"
	},
	templateHelpers: function() {
		return {
			btnclass: (this.model.get("showVirtual")) ? "btn-success" : "btn-warning",
			btntext: "show: " + this.model.get("showVirtual")
		}
	},
	ui: {
		removebtn: '.btn-danger',
		truebtn: '.truebtn'
	},
	triggers: {
		'click @ui.removebtn': 'movie:delete',
		'click @ui.truebtn': 'movie:changeshow'
	}
});

// Composite view
var MovieCompViewFull = Marionette.CompositeView.extend({
	template: "#movie-list",
	ui: {
		btnAdd: '.btnadditem',
		btnReset: '.btnreset'
	},
	events: {
		'click @ui.btnAdd': 'addItem',
		'click @ui.btnReset': 'resetCol'
	},
	addItem: function() {
		this.collection.add(generateModel());
	},
	resetCol: function() {
		this.collection.reset(generateModels(15));
	},
	templateHelpers: function () {
		return {
			title: "Full collection"
		}
	},
	childViewContainer: ".panel-body",
	childView: movieItemView
});

var MovieCompViewVirtual = MovieCompViewFull.extend({
	templateHelpers: function () {
		return {
			title: "Virtual collection (filter: show=true)"
		}
	},
	addItem: function() {
		this.collection.add(generateModel(true));
	}
});

// Create a region
var rm = new Marionette.RegionManager();
rm.addRegion("container_col1", "#col1");
rm.addRegion("container_col2", "#col2");

// Full collection view
	// Create instance of composite view
	var movieCompViewInstanceFull = new MovieCompViewFull({
		collection: baseCollection
	});

	// Controller event listeners
	movieCompViewInstanceFull.on("childview:movie:delete", function (view) {
		// Remove model from collection; 'this' revers to the scope of the composite view
		this.collection.remove(view.model);
	});

	movieCompViewInstanceFull.on("childview:movie:changeshow", function (view) {
		// Remove model from collection; 'this' revers to the scope of the composite view
		view.model.set("showVirtual", !view.model.get("showVirtual"));
	});

	// Show the collectionView
	rm.get('container_col1').show(movieCompViewInstanceFull);

// Virtual collection view
	// Create instance of composite view
	var movieCompViewInstanceVirtual = new MovieCompViewVirtual({
		collection: virtualCollection
	});

	// Controller event listeners
	movieCompViewInstanceVirtual.on("childview:movie:delete", function (view) {
		// Remove model from collection; 'this' revers to the scope of the composite view
		this.collection.remove(view.model);
	});

	movieCompViewInstanceVirtual.on("childview:movie:changeshow", function (view) {
		// Remove model from collection; 'this' revers to the scope of the composite view
		view.model.set("showVirtual", !view.model.get("showVirtual"));
	});

	// Show the collectionView
	rm.get('container_col2').show(movieCompViewInstanceVirtual);

// Setup grid
var useLink = true;
var pageableTitles;
if (useLink) {
	// Create pageable collection
	pageableTitles = new Backbone.PaginationCollection(virtualCollection,{
		state: {
			firstPage: 0,
			currentPage: 0,
			pageSize: 4
		}
	});

	pageableTitles.on("add", function() {
		console.log("Model added");
	});

	pageableTitles.on("remove", function() {
		console.log("Model removed");
	});

	pageableTitles.on("reset", function() {
		console.log("PaginationCollection reset");
	});
}
else {
	var PageableTitles = Backbone.PageableCollection.extend({
		mode: "client"
	});

	pageableTitles = new PageableTitles(virtualCollection.models,{
		mode: "client",
		state: {
			firstPage: 0,
			currentPage: 0,
			pageSize: 4
		}
	});
}

// Set up a grid to use the pageable collection
var columns = [{
		name: "title",
		label: "Title",
		cell: "string"
	},
	{
		name: "showVirtual",
		label: "Show in virtual",
		cell: "boolean"
	}];

var pageableGrid = new Backgrid.Grid({
	columns: columns,
	collection: pageableTitles
});

// Render the grid
var $col3 = $("#col3");

/*// Initialize a client-side filter to filter on the client
// mode pageable collection's cache.
var filter = new Backgrid.Extension.ClientSideFilter({
	collection: pageableTitles,
	fields: ['title']
});

// Render the filter
$col3.append(filter.render().el);
 // Add some space to the filter and move it to the right
 $(filter.el).css({float: "right", margin: "20px"});
*/

// Render the grid
$col3.append(pageableGrid.render().el);

// Initialize the paginator
var paginator = new Backgrid.Extension.Paginator({
	collection: pageableTitles
});

// Render the paginator
$col3.append(paginator.render().el);

// Add 'add item' button
$('<button/>', {
	class: "btn btn-primary",
	text: "Add item"
}).appendTo($col3).click(function() {
	pageableTitles.add(generateModel(true));
});

// Add 'reset' button
$('<button/>', {
	class: "btn btn-primary",
	text: "Reset"
}).appendTo($col3).click(function() {
	pageableTitles.reset(generateModels(10));
});
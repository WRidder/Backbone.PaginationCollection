'use strict';

// Include Gulp and other build automation tools and utilities
// See: https://github.com/gulpjs/gulp/blob/master/docs/API.md
var gulp = require('gulp');
require('gulp-grunt')(gulp); // add all the gruntfile tasks to gulp
var watch = require('gulp-watch');
var runSequence = require('run-sequence');
var clean = require('gulp-clean');
var $ = require('gulp-load-plugins')();
var webpack = require('webpack');
var argv = require('minimist')(process.argv.slice(2));

// Settings
var DEST = 'dist';                         // The build output folder
var RELEASE = !!argv.release;                 // Minimize and optimize during a build?

// The default task
gulp.task('default', ['build', 'watch']);

// JSHint
var jshint = require('gulp-jshint');
var stylish = require('jshint-stylish');

gulp.task('lint', function() {
	return gulp.src('src/*.js')
		.pipe(jshint())
		.pipe(jshint.reporter(stylish));
		//.pipe(jshint.reporter('fail'));
});

// Bundle
gulp.task('bundle', function (cb) {
	var started = false;
	var config = require('./config/webpack.js')(RELEASE);
	var bundler = webpack(config);

	function bundle(err, stats) {
		if (err) {
			throw new $.util.PluginError('webpack', err);
		}
		if (!started) {
			started = true;
			return cb();
		}
	}

	bundler.run(bundle);
});

// Move lib to example
gulp.task("move-library", function() {
	return gulp.src("lib/*.js").pipe(gulp.dest("example/js"));
});

// Clean task
gulp.task('build-clean', function() {
	return gulp.src(DEST).pipe(clean());
});

// Build the app from source code
gulp.task('build', function(cb) {
	runSequence('build-clean', 'lint', 'bundle', 'grunt-test', 'move-library', cb);
});

// Watcher
gulp.task('watch', function () {
	watch(['src/**', 'test/**'], function() {
		gulp.start('build');
	});
});

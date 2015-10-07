define([
	'goo/math/Matrix2'
], function (
	Matrix2
) {
	'use strict';

	function Matrix2x2(){
		console.warn('Matrix2x2 has been renamed to Matrix2.');
		Matrix2.apply(this, arguments);
	}
	Matrix2x2.prototype = Object.create(Matrix2.prototype);
	Matrix2x2.prototype.constructor = Matrix2x2;

	return Matrix2;
});

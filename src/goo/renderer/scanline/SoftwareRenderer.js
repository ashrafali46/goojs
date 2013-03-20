define([
	'goo/renderer/Camera',
	'goo/renderer/scanline/Triangle',
	'goo/math/Vector2',
	'goo/math/Vector3',
	'goo/math/Vector4',
	'goo/math/Matrix4x4',
	'goo/renderer/scanline/Edge',
	'goo/renderer/bounds/BoundingSphere',
	'goo/renderer/bounds/BoundingBox'
	],
	/** @lends SoftwareRenderer */

	function (Camera, Triangle, Vector2, Vector3, Vector4, Matrix4x4, Edge, BoundingSphere, BoundingBox) {
	"use strict";

	/**
	*	@class A software renderer able to render triangles to a depth buffer (w-buffer). Occlusion culling is also performed in this class.
	*	@constructor
	*	@param {{width:Number, height:Number, camera:Camera}} parameters A JSON object which has to contain width, height and the camera object to be used.
	*/
	function SoftwareRenderer (parameters) {
		parameters = parameters || {};

		this.width = parameters.width;
		this.height = parameters.height;

		this._clipY = this.height - 1;
		this._clipX = this.width - 1;

		this.camera = parameters.camera;

		// Pre-allocate memory for the edges.
		this._edges = new Array(3);

		var numOfPixels = this.width * this.height;

		var colorBytes = numOfPixels * 4 * Uint8Array.BYTES_PER_ELEMENT;
		var depthBytes = numOfPixels * Float32Array.BYTES_PER_ELEMENT;

		this._frameBuffer = new ArrayBuffer(colorBytes + depthBytes * 2);

		// The color data is used for debugging purposes.
		this._colorData = new Uint8Array(this._frameBuffer, 0, numOfPixels * 4);
		this._depthData = new Float32Array(this._frameBuffer, colorBytes, numOfPixels);
		// Buffer for clearing.
		this._depthClear = new Float32Array(this._frameBuffer, colorBytes + depthBytes, numOfPixels);

		for (var i = 0; i < numOfPixels; i++) {
			this._depthClear[i] = 0.0;
		}

		this._boundingBoxNeighbourIndices = this._generateBoundingBoxNeighbourIndices();
		this._boundingBoxEdgeIndices = this._generateBoundingBoxEdgeIndices();
		this._boundingBoxTriangleIndices = new Uint8Array(12 * 3);

		var triIndices = [
							0,3,4,
							3,7,4,
							0,4,5,
							0,5,1,
							2,1,5,
							2,5,6,
							3,2,6,
							3,6,7,
							0,1,2,
							0,2,3,
							5,4,6,
							7,6,4
						];

		this._boundingBoxTriangleIndices.set(triIndices, 0);

		console.log(this._boundingBoxTriangleIndices);

		// Cohen-Sutherland area constants.
		// (Clipping method for the bounding box)
		// using |0 to enforce integer values , if they are not already forced by creating them with hex notation.
		// http://www.2ality.com/2013/02/asm-js.html
		/*jshint bitwise: false */
		this._INSIDE = 0x0 |0;	// 0000
		this._LEFT = 0x1 |0;	// 0001
		this._RIGHT = 0x2 |0;	// 0010
		this._BELOW = 0x4 |0;	// 0100
		this._ABOVE = 0x8 |0;	// 1000
		/*jshint bitwise: true */

		this.testTriangles = [
			new Triangle(new Vector3(0.2, 0.1, 1.0), new Vector3(0.1, 0.4, 1.0), new Vector3(0.3, 0.3, 1.0)),
			new Triangle(new Vector3(0.5, 0.1, 1.0), new Vector3(0.4, 0.3, 1.0), new Vector3(0.6, 0.4, 1.0)),
			new Triangle(new Vector3(0.8, 0.1, 1.0), new Vector3(0.7, 0.4, 1.0), new Vector3(0.9, 0.4, 1.0)),
			new Triangle(new Vector3(0.1, 0.5, 1.0), new Vector3(0.1, 0.9, 1.0), new Vector3(0.3, 0.7, 1.0)),
			new Triangle(new Vector3(0.15, 0.5, 1.0), new Vector3(0.5, 0.55, 1.0), new Vector3(0.86, 0.5, 1.0)),
			new Triangle(new Vector3(0.7, 0.7, 1.0), new Vector3(0.9, 0.5, 1.0), new Vector3(0.9, 0.9, 1.0))
		];
	}

	SoftwareRenderer.prototype._generateBoundingBoxEdgeIndices = function () {
		var edgeArray = new Array(12);

		edgeArray[0] = [0, 1];
		edgeArray[1] = [1, 2];
		edgeArray[2] = [2, 3];
		edgeArray[3] = [3, 0];
		edgeArray[4] = [4, 5];
		edgeArray[5] = [5, 6];
		edgeArray[6] = [6, 7];
		edgeArray[7] = [7, 0];
		edgeArray[8] = [0, 4];
		edgeArray[9] = [1, 5];
		edgeArray[10] = [2, 6];
		edgeArray[11] = [3, 7];

		return edgeArray;
	};

	/**
	*	Returns the array of neighbours for a vertex index on a boundingbox
	*/
	SoftwareRenderer.prototype._generateBoundingBoxNeighbourIndices = function () {

		var neighbourArray = new Array(8);
		for (var i = 0; i < 8; i++) {
			var n1, n2, n3;
			switch (i) {
			case 0:
				n1 = 3;
				n2 = 1;
				n3 = 4;
				break;
			case 3:
				n1 = 2;
				n2 = 0;
				n3 = 7;
				break;
			case 4:
				n1 = 7;
				n2 = 5;
				n3 = 0;
				break;
			case 7:
				n1 = 6;
				n2 = 4;
				n3 = 3;
				break;
			default :
				n1 = (i + 7) % 8; // behind
				n2 = (i + 1) % 8; // in front
				n3 = (i + 4) % 8; // below or over
				break;
			}

			neighbourArray[i] = [n1, n2, n3];
		}

		return neighbourArray;
	};

	/**
	*	Clears the depth data (Overwrites the depth buffer with the clear buffer).
	*/
	SoftwareRenderer.prototype._clearDepthData = function () {

		this._depthData.set(this._depthClear);
	};

	/**
	*	Renders z-buffer (w-buffer) from the given renderList of entities with OccuderComponents.
	*
	*	@param {Array.<Entity>} renderList The array of entities with attached OccluderComponents.
	*/
	SoftwareRenderer.prototype.render = function (renderList) {

		this._clearDepthData();

		var cameraViewMatrix = this.camera.getViewMatrix();
		var cameraProjectionMatrix = this.camera.getProjectionMatrix();

		// Iterates over the view frustum culled entities and draws them one entity at a time.
		for ( var i = 0; i < renderList.length; i++) {
			var triangles = this._createTrianglesForEntity(renderList[i], cameraViewMatrix, cameraProjectionMatrix);

			for (var t = 0; t < triangles.length; t++) {
				this._renderTriangle(triangles[t]);
			}
		}
	};

	/**
	*	For each entity in the render list , a screen space axis aligned bounding box is created
	*	and the depthBuffer is queried at the bounds of this AABB for checking if the object is visible.
	*
	*	The entity is removed from the renderlist if it is not visible.
	*
	*	@param {Array.<Entity>} renderList The array of entities which are possible occludees.
	*/
	SoftwareRenderer.prototype.performOcclusionCulling = function (renderList) {

		var cameraViewMatrix = this.camera.getViewMatrix();
		var cameraProjectionMatrix = this.camera.getProjectionMatrix();
		var cameraViewProjectionMatrix = Matrix4x4.combine(cameraProjectionMatrix, cameraViewMatrix);
		var cameraNearZInWorld = -this.camera.near;

		for (var i = 0; i < renderList.length; i++) {
			var entity = renderList[i];
			if (entity.meshRendererComponent.cullMode !== 'NeverOcclusionCull') {

				var cull;

				if (entity.meshDataComponent.modelBound instanceof BoundingSphere) {
					cull = this._boundingSphereOcclusionCulling(entity, cameraViewMatrix, cameraProjectionMatrix, cameraNearZInWorld);
				} else if (entity.meshDataComponent.modelBound instanceof BoundingBox) {
					//cull = this._boundingBoxOcclusionCulling(entity, cameraViewProjectionMatrix);
					cull = this._renderedBoundingBoxOcclusionTest(entity, cameraViewProjectionMatrix);
				}

				if (cull) {
					// Removes the entity at the current index.
					renderList.splice(i, 1);
					i--; // Have to compensate the index for the loop.
				}
			}
		}
	};

	/**
	*	Generates a array of homogeneous vertices for a entity's bounding box.
	*	// TODO : These vertices should probably be saved as a typed array for each object which
	*	need to have occludee possibilities.
	*
	*
	*	@return {Array.<Vector4>} vertex array
	*/
	SoftwareRenderer.prototype._generateBoundingBoxVertices = function (entity) {
		var boundingBox = entity.meshDataComponent.modelBound;

		// Create the 8 vertices which create the bounding box.
		var x = boundingBox.xExtent;
		var y = boundingBox.yExtent;
		var z = boundingBox.zExtent;

		var v1 = new Vector4(-x, y, z, 1.0);
		var v2 = new Vector4(-x, y, -z, 1.0);
		var v3 = new Vector4(x, y, -z, 1.0);
		var v4 = new Vector4(x, y, z, 1.0);

		var v5 = new Vector4(-x, -y, z, 1.0);
		var v6 = new Vector4(-x, -y, -z, 1.0);
		var v7 = new Vector4(x, -y, -z, 1.0);
		var v8 = new Vector4(x, -y, z, 1.0);

		return [v1, v2, v3, v4, v5, v6, v7, v8];
	};

	SoftwareRenderer.prototype._createTrianglesForBoundingBox = function (entity, cameraViewProjectionMatrix) {

		var entitityWorldTransformMatrix = entity.transformComponent.worldTransform.matrix;

		// Combine the entity world transform and camera view matrix, since nothing is calculated between these spaces
		var combinedMatrix = Matrix4x4.combine(cameraViewProjectionMatrix, entitityWorldTransformMatrix);

		var vertices = this._generateBoundingBoxVertices(entity);
		// Projection transform + homogeneous divide for every vertex.
		// Early exit on near plane clip.
		for (var i = 0; i < vertices.length; i++) {
			var v = vertices[i];

			combinedMatrix.applyPost(v);

			if (v.w < this.camera.near) {
				// Near plane clipped.
				console.log("Early exit on near plane clipped.");
				return false;
			}

			var div = 1.0 / v.w;
			v.x *= div;
			v.y *= div;
		}

		var triangles = [];
		// Create triangles.
		for (var i = 0; i < this._boundingBoxTriangleIndices.length; i++) {

			var v1 = new Vector4();
			var v2 = new Vector4();
			var v3 = new Vector4();

			v1.data.set(vertices[this._boundingBoxTriangleIndices[i]].data);
			i++;
			v2.data.set(vertices[this._boundingBoxTriangleIndices[i]].data);
			i++;
			v3.data.set(vertices[this._boundingBoxTriangleIndices[i]].data);

			var projectedVertices = [v1, v2, v3];

			// TODO : I think i made the winding clockwise instead of counter clockwise.
			// hence the negation here...
			if (!this._isBackFacingProjected(v1, v2, v3)) {
				continue;
			}

			this._transformToScreenSpace(projectedVertices);

			triangles.push(new Triangle(projectedVertices[0], projectedVertices[1], projectedVertices[2]));
		}

		return triangles;
	};

	/**
	*	@return {Boolean} occluded or not occluded.
	*/
	SoftwareRenderer.prototype._renderedBoundingBoxOcclusionTest = function (entity, cameraViewProjectionMatrix) {

		var triangles = this._createTrianglesForBoundingBox(entity, cameraViewProjectionMatrix);

		// Triangles will be false on near plane clip.
		// Considering this case to be visible.
		if (triangles === false) {
			return false;
		}

		for (var t = 0; t < triangles.length; t++) {
			if (!this._isRenderedTriangleOccluded(triangles[t])){
				return false;
			}
		}

		return true;
	};

	SoftwareRenderer.prototype._boundingBoxOcclusionCulling = function (entity, cameraViewProjectionMatrix) {

		var entitityWorldTransformMatrix = entity.transformComponent.worldTransform.matrix;

		var combinedMatrix = Matrix4x4.combine(cameraViewProjectionMatrix, entitityWorldTransformMatrix);

		var vertices = this._generateBoundingBoxVertices(entity);

		// TODO: Combine the transforms to pixel space.
		// Projection transform + homogeneous divide
		for (var i = 0; i < vertices.length; i++) {
			var v = vertices[i];

			combinedMatrix.applyPost(v);

			if (v.w < this.camera.near) {
				// Near plane clipped.
				console.log("Early exit on near plane clipped.");
				return false;
			}

			var div = 1.0 / v.w;
			v.x *= div;
			v.y *= div;

			// For interpolating in screen space, in the clipping method.
			v.w = 1.0 / v.w;
		}

		this._transformToScreenSpace(vertices);

		// The array contains the min and max x- and y-coordinates as well as the min depth.
		// order : [minX, maxX, minY, maxY, minDepth]
		var minmaxArray = [Infinity, -Infinity, Infinity, -Infinity, -Infinity];

		this._cohenSutherlandClipBox(vertices, minmaxArray);

		// Round values from the clipping conservatively to integer pixel coordinates.
		/*jshint bitwise: false */
		minmaxArray[0] = Math.floor(minmaxArray[0]) |0;
		minmaxArray[1] = Math.ceil(minmaxArray[1]) |0;
		minmaxArray[2] = Math.floor(minmaxArray[2]) |0;
		minmaxArray[3] = Math.ceil(minmaxArray[3]) |0;
		/*jshint bitwise: true */

		//this._clipBoundingBox(vertices, minmaxArray);

		// Clamp the bounding coordinate values to screen. (needed for my own crappy clipping method...)
		/*
		if(minmaxArray[0] < 0) {
			minmaxArray[0] = 0;
		} else {
			minmaxArray[0] = Math.floor(minmaxArray[0]);
		}

		if (minmaxArray[1] > this._clipX){
			minmaxArray[1] = this._clipX;
		} else {
			minmaxArray[1] = Math.ceil(minmaxArray[1]);
		}

		if (minmaxArray[2] < 0) {
			minmaxArray[2] = 0;
		} else {
			minmaxArray[2] = Math.floor(minmaxArray[2]);
		}

		if (minmaxArray[3] > this._clipY){
			minmaxArray[3] = this._clipY;
		} else {
			minmaxArray[3] = Math.ceil(minmaxArray[3]);
		}
		*/

		return this._isBoundingBoxScanlineOccluded(minmaxArray);
	};

	/**
	*	Clips the buonding box's screen space transformed vertices and outputs the minimum and maximum x- and y-coordinates as well as the minimum depth.
	*	This is a implemenation of the Cohen-Sutherland clipping algorithm. The x- and y-coordinates are only valid for comparing as min or max coordinate
	*	if the coordinate is inside the clipping window. The depth is always taken into consideration, which will be overly conservative at some cases, but without doing this,
	*	it will be non-conservative in some cases.
	*
	*	@param {Array.<Vector>} vertices Array of screen space transformed vertices.
	*	@param {Array.<Number>} minmaxArray Array to which the minimum and maximum values are written.
	*/
	SoftwareRenderer.prototype._cohenSutherlandClipBox = function (vertices, minmaxArray) {

	/*
	*	http://en.wikipedia.org/wiki/Cohen%E2%80%93Sutherland
	*	https://www.cs.drexel.edu/~david/Classes/CS430/Lectures/L-03_XPM_2DTransformations.6.pdf
	*	http://www.cse.buffalo.edu/faculty/walters/cs480/NewLect9.pdf
	*	https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Operators/Bitwise_Operators
	*/

		/*jshint bitwise: false */
		var outCodes = new Array(8);
		for (var i = 0; i < 8; i++) {
			var vert = vertices[i];
			var code = this._calculateOutCode(vert);
			outCodes[i] = code;
			if (code === this._INSIDE) {
				// this vertex is inside the screen and shall be used to find minmax.
				if (vert.w > minmaxArray[4]) {
					minmaxArray[4] = vert.w;
				}

				// Minmax X
				if (vert.x > minmaxArray[1]) {
					minmaxArray[1] = vert.x;
				}
				if (vert.x < minmaxArray[0]) {
					minmaxArray[0] = vert.x;
				}

				// Minmax Y
				if (vert.y > minmaxArray[3]) {
					minmaxArray[3] = vert.y;
				}
				if (vert.y < minmaxArray[2]) {
					minmaxArray[2] = vert.y;
				}
			}
		}

		var tempVec = new Vector2(0,0);
		// Go through the edges of the bounding box to clip them if needed.
		for (var edgeIndex = 0; edgeIndex < 12; edgeIndex++) {

			var edgePair = this._boundingBoxEdgeIndices[edgeIndex];
			var vIndex1 = edgePair[0];
			var vIndex2 = edgePair[1];

			var v1 = vertices[vIndex1];
			var outcode1 = outCodes[vIndex1];
			var v2 = vertices[vIndex2];
			var outcode2 = outCodes[vIndex2];

			while (true) {
				/*
				// Initial check if the edge lies inside...
				// Will only be true if both the codes are 0000. 
				// 0000 | 0000 => 0000 , !0 => true
				// 0011 | 0000 => 0011, !0011 => false
				if (!(outcode1 | outcode2)) {
					//console.log("Entirely inside");
					break;
				}
				// ...or outside
				// will only be non-zero when the two endcodes are in
				// the aligned vertical or horizontal areas outside the clipping window.
				if (outcode1 & outcode2) {
					//console.log("Entirely outside");
					break;
				}
				*/

				// Combined the cases since nothing special is done depending if the lines are
				// entirely inside or outside.
				if (!(outcode1 | outcode2) || outcode1 & outcode2) {
					break;
				}

				// Pick the code which is outside. (not 0). This point is outside the clipping window.
				var outsideCode = outcode1 ? outcode1 : outcode2;
				// ratio for interpolating depth and translating to the intersection coordinate.
				var ratio;
				// nextCode is the intersection coordinate's outcode.
				var nextCode;

				// Checking for match in bitorder, starting with ABOVE == 1000, then BELOW == 0100,
				// 0010 and 0001.
				if (outsideCode & this._ABOVE) {
					ratio = ((this._clipY - v1.y) / (v2.y - v1.y));
					tempVec.x = v1.x + (v2.x - v1.x) * ratio;
					tempVec.y = this._clipY;

					// Only check for minmax x and y if the new coordinate is inside.
					nextCode = this._calculateOutCode(tempVec);
					if (nextCode === this._INSIDE) {
						minmaxArray[3] = this._clipY;
						// Minmax X
						if (tempVec.x > minmaxArray[1]) {
							minmaxArray[1] = tempVec.x;
						}
						if (tempVec.x < minmaxArray[0]) {
							minmaxArray[0] = tempVec.x;
						}
					}
				} else if (outsideCode & this._BELOW) {
					ratio = (-v1.y / (v2.y - v1.y));
					tempVec.x = v1.x + (v2.x - v1.x) * ratio;
					tempVec.y = 0;

					// Only check for minmax x and y if the new coordinate is inside.
					nextCode = this._calculateOutCode(tempVec);
					if (nextCode === this._INSIDE) {
						minmaxArray[2] = 0;
						// Minmax X
						if (tempVec.x > minmaxArray[1]) {
							minmaxArray[1] = tempVec.x;
						}
						if (tempVec.x < minmaxArray[0]) {
							minmaxArray[0] = tempVec.x;
						}
					}
				} else if (outsideCode & this._RIGHT) {
					ratio = ((this._clipX - v1.x) / (v2.x - v1.x));
					tempVec.y = v1.y + (v2.y - v1.y) * ratio;
					tempVec.x = this._clipX;

					nextCode = this._calculateOutCode(tempVec);
					if (nextCode === this._INSIDE) {
						minmaxArray[1] = this._clipX;
						// Minmax Y
						if (tempVec.y > minmaxArray[3]) {
							minmaxArray[3] = tempVec.y;
						}
						if (tempVec.y < minmaxArray[2]) {
							minmaxArray[2] = tempVec.y;
						}
					}
				} else if (outsideCode & this._LEFT) {
					ratio = (-v1.x / (v2.x - v1.x));
					tempVec.y = v1.y + (v2.y - v1.y) * ratio;
					tempVec.x = 0;

					nextCode = this._calculateOutCode(tempVec);
					if (nextCode === this._INSIDE) {
						minmaxArray[0] = 0;
						// Minmax Y
						if (tempVec.y > minmaxArray[3]) {
							minmaxArray[3] = tempVec.y;
						}
						if (tempVec.y < minmaxArray[2]) {
							minmaxArray[2] = tempVec.y;
						}
					}
				}

				// Calculate outcode for the new position, overwrite the code which was outside.
				var depth;
				if (outsideCode === outcode1) {
					outcode1 = nextCode;
					// Interpolate the depth.
					depth = (1.0 - ratio) * v1.w + ratio * v2.w;
				} else {
					outcode2 = nextCode;
					depth = (1.0 - ratio) * v2.w + ratio * v1.w;
				}

				// Check for minimum depth.
				if (depth > minmaxArray[4]) {
					minmaxArray[4] = depth;
				}
			}
		}
		/*jshint bitwise: true */
	};

	/**
	*	Calculates outcode for a coordinate in screen pixel space used by the Coher-Sutherland clipping algorithm.
	*	The number returned is possibly a combination of the five different bit-coded areas used in the clipping algorithm.
	*	@return {Number} outcode A possible combination of 0000, 0001, 0010, 0100 and 1000. 
	*/
	SoftwareRenderer.prototype._calculateOutCode = function (coordinate) {

		// Regard the coordinate as being inside the clip window initially.
		var outcode = this._INSIDE;
		/*jshint bitwise: false */
		if (coordinate.x < 0) {
			outcode |= this._LEFT;
		} else if (coordinate.x > this._clipX) {
			outcode |= this._RIGHT;
		}

		if (coordinate.y < 0) {
			outcode |= this._BELOW;
		} else if (coordinate.y > this._clipY) {
			outcode |= this._ABOVE;
		}
		/* jshint bitwise: true */
		return outcode;
	};

	/**
	*	Clips the BoundingBox to screen coordinates to later produce a correct screen space bounding box of the bounding box.
	*	// TODO: In case of clipping , the min / max values for either x or y could be known from here. This could be returned in
	*	some way.
	*/
	SoftwareRenderer.prototype._clipBoundingBox = function (vertices, minmaxArray) {

		var insideScreen = new Array(8);

		for (var i = 0; i < 8; i++) {
			insideScreen[i] = this._isCoordinateInsideScreen(vertices[i]);
		}

		for (var i = 0; i < 8; i++) {
			// Clip if not inside screen.
			if(!insideScreen[i]) {
				var currentVertex = vertices[i];
				var targetNeighbours = [];
				for (var j = 0; j < 3; j++) {
					var neighbourIndex = this._boundingBoxNeighbourIndices[i][j];
					if (insideScreen[neighbourIndex]) {
						targetNeighbours.push(vertices[neighbourIndex]);
					}
				}

				// Interpolate vertex along the edge to the taergetNeighbour. The amount shall be the axis which is most outside.
				// TODO : Somehow save the checks from the control if the vertex is inside or not to be able to know already which side
				//		is outside. Maybe create a new function for this, and return different integers which says which area the vertex
				//		is located in if it is outside the screen along with the amount.
				// Seems like the Cohen-Sutherland method involves doing something like this....

				if (!targetNeighbours[0]) {
					// No neighbours inside the screen.
					// TODO : Refactor to remove continue statement. acoording to Javascript : The Good Parts.
					continue;
				}


				var xDiff, yDiff;
				var underX = false;
				var underY = false;
				if (currentVertex.x < 0) {
					xDiff = -currentVertex.x;
					underX = true;
				} else {
					xDiff = currentVertex.x - this._clipX;
				}

				if (currentVertex.y < 0) {
					yDiff = -currentVertex.y;
					underY = true;
				} else {
					yDiff = currentVertex.y - this._clipY;
				}

				// Calculate the ratio by using the largest diff.
				var ratio;
				var a;
				var spanLength;
				if (xDiff > yDiff) {
					// Find the ratio which gives the closest depth,
					for (var n = 0; n < targetNeighbours.length; n++) {
						var neighbour = targetNeighbours[n];

						if (underX) {
							spanLength = neighbour.x + xDiff + 1;
						} else {
							spanLength = currentVertex.x - neighbour.x + 1;
						}

						ratio = xDiff / spanLength;
						a = 1.0 - ratio;
						var tempDepth = a * currentVertex.w + ratio * neighbour.w;

						// Interpolate to new Y , since we are outside on the X-side.
						var newY = currentVertex.y + ratio * (neighbour.y - currentVertex.y);

						if (tempDepth > minmaxArray[4]) {
							minmaxArray[4] = tempDepth;
						}

						if (underX) {
							minmaxArray[0] = 0;
						} else {
							minmaxArray[1] = this._clipX;
						}

						// Minmax Y
						if (newY > minmaxArray[3]) {
							minmaxArray[3] = newY;
						}
						if (newY < minmaxArray[2]) {
							minmaxArray[2] = newY;
						}
					}

				} else {
					// The current vertex is further outside on the Y axis.
					// Find the ratio which gives the closest depth,
					for (var n = 0; n < targetNeighbours.length; n++) {
						var neighbour = targetNeighbours[n];

						if (underY) {
							spanLength = neighbour.y + yDiff + 1;
						} else {
							spanLength = currentVertex.y - neighbour.y + 1;
						}

						ratio = yDiff / spanLength;
						a = 1.0 - ratio;
						var tempDepth = a * currentVertex.w + ratio * neighbour.w;

						// Interpolate to new X , since we are outside on the Yside.
						var newX = currentVertex.x + ratio * (neighbour.x - currentVertex.x);

						if (tempDepth > minmaxArray[4]) {
							minmaxArray[4] = tempDepth;
						}

						if (underY) {
							minmaxArray[2] = 0;
						} else {
							minmaxArray[3] = this._clipY;
						}

						// Minmax X
						if (newX > minmaxArray[1]) {
							minmaxArray[1] = newX;
						}
						if (newX < minmaxArray[0]) {
							minmaxArray[0] = newX;
						}
					}
				}
			} else {
				// If the vertex is inside the screen.
				// Check for min max values of the vertex.
				// Min Depth
				var vert = vertices[i];
				if (vert.w > minmaxArray[4]) {
					minmaxArray[4] = vert.w;
				}

				// Minmax X
				if (vert.x > minmaxArray[1]) {
					minmaxArray[1] = vert.x;
				}
				if (vert.x < minmaxArray[0]) {
					minmaxArray[0] = vert.x;
				}

				// Minmax Y
				if (vert.y > minmaxArray[3]) {
					minmaxArray[3] = vert.y;
				}
				if (vert.y < minmaxArray[2]) {
					minmaxArray[2] = vert.y;
				}
			}
		}
		return true;
	};

	/**
	*	Creates a screen space axis aligned box from the min and max values.
	*	The depth buffer is checked for each pixel the box covers against the nearest depth of the Bounding Box.
	*	@return {Boolean} occluded or not occluded.
	*/
	SoftwareRenderer.prototype._isBoundingBoxScanlineOccluded = function (minmaxArray) {
		// Run the scanline test for each row [maxY, minY] , [minX, maxX]
		for (var scanline = minmaxArray[3]; scanline >= minmaxArray[2]; scanline--) {
			var sampleCoordinate = scanline * this.width + minmaxArray[0];
			for (var x = minmaxArray[0]; x <= minmaxArray[1]; x++) {
				this._colorData.set([0,0,255], sampleCoordinate * 4); // create some blue ( DEBUGGING ).
				if (this._depthData[sampleCoordinate] < minmaxArray[4]) {
					return false;
				}
				sampleCoordinate++;
			}
		}

		return true;
	};

	/**
	*	Return true if the object is occluded.
	*/
	SoftwareRenderer.prototype._boundingSphereOcclusionCulling = function (entity, cameraViewMatrix, cameraProjectionMatrix, cameraNearZInWorld) {

		var entitityWorldTransformMatrix = entity.transformComponent.worldTransform.matrix;
		var combinedMatrix = Matrix4x4.combine(cameraViewMatrix, entitityWorldTransformMatrix);

		var boundingSphere = entity.meshDataComponent.modelBound;
		var origin = new Vector4(0,0,0,1.0);
		combinedMatrix.applyPost(origin);

		var scale = entity.transformComponent.transform.scale;
		var radius = Math.abs(boundingSphere._maxAxis(scale) * boundingSphere.radius);

		// Compensate for perspective distortion of the sphere.
		// http://article.gmane.org/gmane.games.devel.algorithms/21697/
		// http://www.gamasutra.com/view/feature/2942/the_mechanics_of_robust_stencil_.php?page=6
		// http://www.nickdarnell.com/2010/06/hierarchical-z-buffer-occlusion-culling/
		// Bounds.w == radius.
		// float fRadius = CameraSphereDistance * tan(asin(Bounds.w / CameraSphereDistance));
		var cameraToSphereDistance = Math.sqrt(origin.x * origin.x + origin.y * origin.y + origin.z * origin.z);

		// https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Math/asin
		// The asin method returns a numeric value between -pi/2 and pi/2 radians for x between -1 and 1. If the value of number is outside this range, it returns NaN.
		if (cameraToSphereDistance <= radius ) {
			return false;
		}
		radius = cameraToSphereDistance * Math.tan(Math.asin(radius / cameraToSphereDistance));

		// The coordinate which is closest to the near plane should be at one radius step closer to the camera.
		var nearCoord = new Vector4(origin.x, origin.y, origin.z + radius, origin.w);

		if (nearCoord.z > cameraNearZInWorld) {
			// The bounding sphere intersects the near plane, assuming to have to draw the entity by default.
			return false;
		}

		var leftCoord = new Vector4(origin.x - radius, origin.y, origin.z, 1.0);
		var rightCoord = new Vector4(origin.x + radius, origin.y, origin.z, 1.0);
		var topCoord = new Vector4(origin.x, origin.y + radius, origin.z, 1.0);
		var bottomCoord = new Vector4(origin.x , origin.y - radius, origin.z, 1.0);

		var vertices = [nearCoord, leftCoord, rightCoord, topCoord, bottomCoord];

		// TODO : Create a combined matrix of the projection and screenspace
		this._projectionTransform(vertices, cameraProjectionMatrix);
		this._transformToScreenSpace(vertices);

		// Some conservative rounding of the coordinates to integer pixel coordinates.
		leftCoord.x = Math.floor(leftCoord.x);
		leftCoord.y = Math.round(leftCoord.y);

		rightCoord.x = Math.ceil(rightCoord.x);
		rightCoord.y = Math.round(rightCoord.y);

		topCoord.x = Math.round(topCoord.x);
		topCoord.y = Math.ceil(topCoord.y);

		bottomCoord.x = Math.round(bottomCoord.x);
		bottomCoord.y = Math.floor(bottomCoord.y);

		nearCoord.x = Math.round(nearCoord.x);
		nearCoord.y = Math.round(nearCoord.y);

		var red = [255, 0, 0];
		var green = [0, 255, 0];
		var blue = [0, 0, 255];
		var yellow = [255, 255, 0];
		var pink = [255, 0, 255];
		//var cyan = [0, 190, 190];

		var nearestDepth = 1.0 / nearCoord.w;

		// Executes the occluded test in the order they are put, exits the case upon any false value.
		// TODO: Test for best order of early tests.
		/*
		this._isOccluded(topCoord, yellow, nearestDepth);
		this._isOccluded(leftCoord, blue, nearestDepth);
		this._isOccluded(rightCoord, green, nearestDepth);
		this._isOccluded(bottomCoord, yellow, nearestDepth);
		this._isOccluded(nearCoord, red, nearestDepth);
		*/

		return (this._isOccluded(topCoord, yellow, nearestDepth)
			&& this._isOccluded(leftCoord, blue, nearestDepth)
			&& this._isOccluded(rightCoord, green, nearestDepth)
			&& this._isOccluded(bottomCoord, yellow, nearestDepth)
			&& this._isOccluded(nearCoord, red, nearestDepth)
			&& this._isPythagorasCircleScanlineOccluded(topCoord, bottomCoord, rightCoord, leftCoord, nearestDepth, pink));

		//return this._isPythagorasCircleScanlineOccluded(topCoord, bottomCoord, rightCoord, leftCoord, nearestDepth, pink);
		//return this._isSSAABBScanlineOccluded(leftCoord, rightCoord, topCoord, bottomCoord, green, nearestDepth);
	};

	/**
	*	Creates a screen space axis aligned bounding box from the bounding sphere's
	*	coordinates and performs scanline tests against the depthbuffer with the given nearest depth.
	*
	*	@return {Boolean} occluded or not occluded.
	*/
	SoftwareRenderer.prototype._isSSAABBScanlineOccluded = function (leftCoordinate, rightCoordinate, topCoordinate, bottomCoordinate, color, nearestDepth) {

		var leftX = leftCoordinate.x;
		var rightX = rightCoordinate.x;

		var firstScanline = topCoordinate.y;
		var lastScanline = bottomCoordinate.y;

		// Round the values to create a conservative check.
		leftX = Math.floor(leftX);
		rightX = Math.ceil(rightX);
		firstScanline = Math.ceil(firstScanline);
		lastScanline = Math.floor(lastScanline);

		if (leftX < 0) {
			leftX = 0;
		}

		if (rightX > this._clipX) {
			rightX = this._clipX;
		}

		if (firstScanline > this._clipY) {
			firstScanline = this._clipY;
		}

		if (lastScanline < 0) {
			lastScanline = 0;
		}

		// Scanline check the interval [firstScanline, lastScanline].
		// Iterating downwards!
		for (var y = firstScanline; y >= lastScanline; y--) {
			var sampleCoord = y * this.width + leftX;
			// Check interval [leftX, rightX].
			for (var x = leftX; x <= rightX; x++) {
				// Debug, add color where scanline samples are taken.
				this._colorData.set(color, sampleCoord * 4);

				if(this._depthData[sampleCoord] < nearestDepth) {
					// Early exit if the sample is visible.
					return false;
				}
				sampleCoord++;
			}
		}

		return true;
	};

	/**
	*	Clamps the parameter coordinates to the screen's readable coordinates.
	*	// TODO : Have to use an object as parameter instead. The function is not usable cause the values aren't passed as reference.
	*
	*	@param {Number} minX
	*	@param {Number} maxX
	*	@param {Number} minY
	*	@param {Number} maxY
	*/
	SoftwareRenderer.prototype._clampToScreen = function (minX, maxX, minY, maxY) {
		if (minX < 0) {
			minX = 0;
		}

		if (maxX > this._clipX) {
			maxX = this._clipX;
		}

		if (minY < 0) {
			minY = 0;
		}

		if (maxY > this._clipY) {
			maxY = this._clipY;
		}
	};

	SoftwareRenderer.prototype._isPythagorasCircleScanlineOccluded = function(topCoordinate, bottomCoordinate, rightCoordinate, leftCoordinate, nearestDepth, color) {
		// Saving the number of rows minus one row. This is the value of use when calculating the tIncrements.
		var topRows = topCoordinate.y - rightCoordinate.y;
		var botRows = rightCoordinate.y - bottomCoordinate.y;

		var radius = rightCoordinate.x - topCoordinate.x;
		var r2 = radius * radius;
		var ratio = this.width / this.height;

		// skip the top , since that will be the top coordinate , which has already been checked. Start at the next one.
		// y is the current scanline.
		var y = topCoordinate.y - 1;

		// TODO : The cases after the two first ones might not happen often enough to be of value. Tune these in the end.
		if ((topRows <= 1 && botRows <= 1) || topCoordinate.y <= 0 || bottomCoordinate.y >= this._clipY) {
			// Early exit when the number of rows are 1 or less than one, there is no height in the circle at this point.
			// This misses the middle line, might be too non-conservative !

			// DEBUGGGING Set the pixels to cyan so i know this is where it finished sampling.
			var cyan = [0, 255, 255];
			var sampleCoord;
			if (this._isCoordinateInsideScreen(topCoordinate)) {
				sampleCoord = topCoordinate.y * this.width + topCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}

			if (this._isCoordinateInsideScreen(bottomCoordinate)) {
				sampleCoord = bottomCoordinate.y * this.width + bottomCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}
			if (this._isCoordinateInsideScreen(leftCoordinate)) {
				sampleCoord = leftCoordinate.y * this.width + leftCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}
			if (this._isCoordinateInsideScreen(rightCoordinate)) {
				sampleCoord = rightCoordinate.y * this.width + rightCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}

			return true;
		}

		// Vertical clip.
		var yH = 1;
		if (rightCoordinate.y >= this._clipY) {

			// The entire upper part of the circle is above the screen if this is true.
			// Set y to clipY , the next step shall be the middle of the circle.
			topRows = 0;
			y = this._clipY;

		} else {

			// If the top (start) coordinate is above the screen, step down to the right y coordinate (this._clipY),
			// remove the number of rows to interpolate on, update the interpolation value t.
			var topDiff = y - this._clipY;
			if (topDiff > 0) {
				topRows -= topDiff;
				yH += topDiff;
				y = this._clipY;
			}

			// Remove one row for each row that the right y-coordinate is below or equals to -2.
			// This because lines are checked up until rightcoordinate - 1.
			var rightUnder = - (rightCoordinate.y + 1);
			if (rightUnder > 0) {
				topRows -= rightUnder;
			}
		}

		// Interpolate x-coordinates with t in the range [tIncrement, 1.0 - tIncrement]
		// Removes the last iteration.
		topRows -= 1;
		for (var i = 0; i < topRows; i++) {

			var b = radius - ratio * yH;
			var x = Math.sqrt(r2 - b * b);
			var rightX = Math.ceil(topCoordinate.x + x);
			var leftX = Math.floor(topCoordinate.x - x);

			// Horizontal clipping
			if (leftX < 0) {
				leftX = 0;
			}

			if (rightX > this._clipX) {
				rightX = this._clipX;
			}

			var sampleCoord = y * this.width + leftX;

			for(var xindex = leftX; xindex <= rightX; xindex++) {

				this._colorData.set(color, sampleCoord * 4);
				if(this._depthData[sampleCoord] < nearestDepth) {
					// Early exit if the sample is visible.
					return false;
				}

				sampleCoord++;
			}
			y--;
			yH++;
		}

		if (y < 0) {
			// Hurray! Outside screen, it's hidden.
			// This will happen when the right y-coordinate is below 0 from the start.
			return true;
		}

		if(topRows >= -1 && rightCoordinate.y <= this._clipY) {
			// Check the middle scanline , the pixels in between the left and right coordinates.
			var leftX = leftCoordinate.x + 1;
			if (leftX < 0) {
				leftX = 0;
			}
			var rightX = rightCoordinate.x - 1;
			if (rightX > this._clipX) {
				rightX = this._clipX;
			}
			var midCoord = y * this.width + leftX;
			for (var i = leftX; i <= rightX; i++) {

				this._colorData.set(color, midCoord * 4);

				if (this._depthData[midCoord] < nearestDepth) {
					return false;
				}
				midCoord++;
			}
			// Move down to the next scanline.
			y--;
		}

		// The Bottom of the "circle"
		yH = botRows - 1;
		var topDiff = rightCoordinate.y - y - 1;
		if (topDiff > 0) {
			botRows -= topDiff;
			yH -= topDiff;
		}
		// Remove one row for each row that the right y-coordinate is below or equals to -2.
		var botDiff = - (bottomCoordinate.y + 1);
		if (botDiff > 0) {
			botRows -= botDiff;
		}

		// Interpolate x-coordinates with t in the range [tIncrement, 1.0 - tIncrement].
		// Remove the last iteration.
		botRows -= 1;
		radius = rightCoordinate.x - bottomCoordinate.x;
		for (var i = 0; i < botRows; i++) {

			var b = radius - ratio * yH;
			var x = Math.sqrt(r2 - b * b);
			var rightX = Math.ceil(topCoordinate.x + x);
			var leftX = Math.floor(topCoordinate.x - x);

			// Horizontal clipping
			if (leftX < 0) {
				leftX = 0;
			}
			if (rightX > this._clipX) {
				rightX = this._clipX;
			}

			var sampleCoord = y * this.width + leftX;
			for(var xindex = leftX; xindex <= rightX; xindex++) {
				// Debug, add color where scanline samples are taken.
				this._colorData.set(color, sampleCoord * 4);

				if(this._depthData[sampleCoord] < nearestDepth) {
					// Early exit if the sample is visible.
					return false;
				}
				sampleCoord++;
			}
			y--;
			yH--;
		}

		return true;
	};

	/**
	*	Check each scanline value of the bounding sphere, early exit upon finding a visible pixel. Uses bezier curve approximation of the bounding sphere.
	*	Returns true if the object is occluded.
	*
	*	@return {Boolean} occluded or not occluded
	*/
	SoftwareRenderer.prototype._isBezierScanlineOccluded = function (topCoordinate, bottomCoordinate, rightCoordinate, leftCoordinate, nearestDepth, color) {

		// Saving the number of rows minus one row. This is the value of use when calculating the tIncrements.
		var topRows = topCoordinate.y - rightCoordinate.y;
		var botRows = rightCoordinate.y - bottomCoordinate.y;

		// skip the top , since that will be the top coordinate , which has already been checked. Start at the next one.
		// y is the current scanline.
		var y = topCoordinate.y - 1;

		// TODO : The cases after the two first ones might not happen often enough to be of value. Tune these in the end.
		if ((topRows <= 1 && botRows <= 1) || topCoordinate.y <= 0 || bottomCoordinate.y >= this._clipY) {
			// Early exit when the number of rows are 1 or less than one, there is no height in the circle at this point.
			// This misses the middle line, might be too non-conservative !

			// DEBUGGGING Set the pixels to cyan so i know this is where it finished sampling.
			var cyan = [0, 255, 255];
			var sampleCoord;
			if (this._isCoordinateInsideScreen(topCoordinate)) {
				sampleCoord = topCoordinate.y * this.width + topCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}

			if (this._isCoordinateInsideScreen(bottomCoordinate)) {
				sampleCoord = bottomCoordinate.y * this.width + bottomCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}
			if (this._isCoordinateInsideScreen(leftCoordinate)) {
				sampleCoord = leftCoordinate.y * this.width + leftCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}
			if (this._isCoordinateInsideScreen(rightCoordinate)) {
				sampleCoord = rightCoordinate.y * this.width + rightCoordinate.x;
				this._colorData.set(cyan, sampleCoord * 4);
			}
			return true;
		}

		var tIncrement = 1.0 / (topRows);
		var t = tIncrement;

		// Vertical clip.
		if (rightCoordinate.y >= this._clipY) {

			// The entire upper part of the circle is above the screen if this is true.
			// Set y to clipY , the next step shall be the middle of the circle.
			topRows = 0;
			y = this._clipY;

		} else {
			// If the top (start) coordinate is above the screen, step down to the right y coordinate (this._clipY),
			// remove the number of rows to interpolate on, update the interpolation value t.
			var topDiff = y - this._clipY;
			if (topDiff > 0) {
				topRows -= topDiff;
				t += topDiff * tIncrement;
				y = this._clipY;
			}

			// Remove one row for each row that the right y-coordinate is below or equals to -2.
			// This because lines are checked up until rightcoordinate - 1.
			var rightUnder = - (rightCoordinate.y + 1);
			if (rightUnder > 0) {
				topRows -= rightUnder;
			}
		}

		// Interpolate x-coordinates with t in the range [tIncrement, 1.0 - tIncrement]
		// Removes the last iteration.
		topRows -= 1;
		for (var i = 0; i < topRows; i++) {

			var t1 = (1.0 - t);
			// Bezier curve approximated bounds, simplified due to the corner x-coordinate is the same as the last one

			//var rightX = t1 * t1 * topCoordinate.x + 2 * t1 * t * rightCoordinate.x + t * t * rightCoordinate.x;
			// var x = t1 * t1 * topCoordinate.x + (2.0 * t - t * t) * rightCoordinate.x;
			var rightX = t1 * t1 * topCoordinate.x + (2.0 - t) * t * rightCoordinate.x;
			rightX = Math.ceil(rightX);
			var leftX = topCoordinate.x - (rightX - topCoordinate.x);

			// Horizontal clipping
			if (leftX < 0) {
				leftX = 0;
			}

			if (rightX > this._clipX) {
				rightX = this._clipX;
			}

			var sampleCoord = y * this.width + leftX;
			for(var xindex = leftX; xindex <= rightX; xindex++) {
				this._colorData.set(color, sampleCoord * 4);
				if(this._depthData[sampleCoord] < nearestDepth) {
					// Early exit if the sample is visible.
					return false;
				}
				sampleCoord++;
			}

			t += tIncrement;
			y--;
		}

		if (y < 0) {
			// Hurray! Outside screen, it's hidden.
			// This will happen when the right y-coordinate is below 0 from the start.
			return true;
		}

		if(topRows >= -1 && rightCoordinate.y <= this._clipY) {
			// Check the middle scanline , the pixels in between the left and right coordinates.
			var leftX = leftCoordinate.x + 1;
			if (leftX < 0) {
				leftX = 0;
			}
			var rightX = rightCoordinate.x - 1;
			if (rightX > this._clipX) {
				rightX = this._clipX;
			}
			var midCoord = y * this.width + leftX;
			for (var i = leftX; i <= rightX; i++) {

				this._colorData.set(color, midCoord * 4);

				if (this._depthData[midCoord] < nearestDepth) {
					return false;
				}
				midCoord++;
			}
			// Move down to the next scanline.
			y--;
		}

		// The Bottom of the "circle"
		tIncrement = 1.0 / (botRows);
		t = tIncrement;
		var topDiff = rightCoordinate.y - y - 1;
		if (topDiff > 0) {
			botRows -= topDiff;
			t += topDiff * tIncrement;
		}

		// Remove one row for each row that the right y-coordinate is below or equals to -2.
		var botDiff = - (bottomCoordinate.y + 1);
		if (botDiff > 0) {
			botRows -= botDiff;
		}

		// Interpolate x-coordinates with t in the range [tIncrement, 1.0 - tIncrement].
		// Remove the last iteration.
		botRows -= 1;
		for (var i = 0; i < botRows; i++) {

			var t1 = (1.0 - t);

			// This time , the first two points of the bezier interpolation are the same, simplified the algebra.
			var rightX = ((t1 + 2.0 * t) * t1) * rightCoordinate.x + t * t * bottomCoordinate.x;
			rightX = Math.ceil(rightX);
			var leftX = bottomCoordinate.x - (rightX - bottomCoordinate.x);

			// Horizontal clipping
			if (leftX < 0) {
				leftX = 0;
			}
			if (rightX > this._clipX) {
				rightX = this._clipX;
			}

			var sampleCoord = y * this.width + leftX;

			for(var xindex = leftX; xindex <= rightX; xindex++) {

				// Debug, add color where scanline samples are taken.
				this._colorData.set(color, sampleCoord * 4);

				if(this._depthData[sampleCoord] < nearestDepth) {
					// Early exit if the sample is visible.
					return false;
				}

				sampleCoord++;
			}

			t += tIncrement;
			y--;
		}

		return true;
	};

	/**
	*	Check occlusion on a given coordinate.
	*	If the coordinate is inside the screen pixel space, the given depth value is compared,
	*	otherwise the coordinate is assumed to be occluded.
	*
	*	@param {Vector} coordinate The coordinate to look-up
	*	@return {Boolean} true or false, occluded or not occluded.
	*/
	SoftwareRenderer.prototype._isOccluded = function (coordinate, color, nearestDepth) {

		if (this._isCoordinateInsideScreen(coordinate)) {

			var coordIndex = coordinate.y * this.width + coordinate.x;

			// Add color to the color daata (DEBUGGING PURPOSE)
			this._colorData.set(color, coordIndex * 4);

			// the sample contains 1/w depth. if the corresponding depth in the nearCoordinate is behind the sample, the entity is occluded.
			return nearestDepth < this._depthData[coordIndex];
		}
		// Assume that the object is occluded when the coordinate is outside the screen.
		// The scanline test will have to clip to the correct pixel for look-up.
		return true;
	};

	/**
	*	Returns true if the coordinate is inside the screen pixel space. Otherwise it returns false.
	*
	*	@param {Vector} coordinate
	*	@return {Boolean} true/false
	*/
	SoftwareRenderer.prototype._isCoordinateInsideScreen = function (coordinate) {
		return coordinate.x >= 0 && coordinate.x <= this._clipX && coordinate.y <= this._clipY && coordinate.y >= 0;
	};


	/**
	*	Creates an array of the visible {Triangle} for the entity
	*	@param {Entity} entity, the entity from which to create triangles.
	*	@return {Array.<Triangle>} triangle array
	*/
	SoftwareRenderer.prototype._createTrianglesForEntity = function (entity, cameraViewMatrix, cameraProjectionMatrix) {

		var originalPositions = entity.occluderComponent.meshData.dataViews.POSITION;
		var vertIndexArray = entity.occluderComponent.meshData.indexData.data;

		// Allocate the trianle array for the maximum case,
		// where all the triangles are visible.
		// This will raise a need for checking for undefined during the rendering of the triangles.
		var triangles = [];

		var entitityWorldTransformMatrix = entity.transformComponent.worldTransform.matrix;
		var cameraNearZInWorld = -this.camera.near;

		// Combine the entity world transform and camera view matrix, since nothing is calculated between these spaces
		var combinedMatrix = Matrix4x4.combine(cameraViewMatrix, entitityWorldTransformMatrix);

		var posArray = new Float32Array(originalPositions.length);
		var tempVertex = Vector4.UNIT_W;
		// Transform vertices to camera view space beforehand to not transform several times on a vertex. ( up to three times ).
		// The homogeneous coordinate,w , will not be altered during this transformation. And remains 1.0.
		for (var i = 0; i < posArray.length; i++) {
			tempVertex.set(originalPositions[i], originalPositions[i + 1], originalPositions[i + 2], 1.0);
			combinedMatrix.applyPost(tempVertex);
			posArray.set([tempVertex.x, tempVertex.y, tempVertex.z], i);
			i += 2;
		}

		for (var vertIndex = 0; vertIndex < vertIndexArray.length; vertIndex++ ) {

			var posIndex = vertIndexArray[vertIndex] * 3;
			var v1 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

			posIndex = vertIndexArray[++vertIndex] * 3;
			var v2 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

			posIndex = vertIndexArray[++vertIndex] * 3;
			var v3 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

			var vertices = [v1, v2, v3];

			if (this._isBackFacingCameraViewSpace(v1, v2, v3)) {
				continue; // Skip loop to the next three vertices.
			}

			// Clip triangle to the near plane.

			// Outside incides are the vertices which are outside the view frustrum,
			// that is closer than the near plane in this case.
			// The inside indices are the ones on the inside.
			var outsideIndices = [];
			var insideIndices = [];

			this._categorizeVertices(outsideIndices, insideIndices, vertices, cameraNearZInWorld);

			switch (outsideIndices.length) {
				case 0:
					// All vertices are on the inside. Continue as usual.
					break;
				case 3:
					// All of the vertices are on the outside, skip to the next three vertices.
					// TODO : Refactor to remove continue statement. acoording to Javascript : The Good Parts.
					continue;
				case 1:
					// Update the one vertex to its new position on the near plane and add a new vertex
					// on the other intersection with the plane.

					// TODO: Small optimization, the origin.z + near calculation in intersectionratio()
					// 		 can be performed once here instead of twice.

					var origin = vertices[outsideIndices[0]];
					var target = vertices[insideIndices[0]];
					var ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

					var newV1 = [
						origin.x + ratio * (target.x - origin.x),
						origin.y + ratio * (target.y - origin.y),
						origin.z + ratio * (target.z - origin.z)
					];

					target = vertices[insideIndices[1]];
					ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

					var newV2 = new Vector4(
						origin.x + ratio * (target.x - origin.x),
						origin.y + ratio * (target.y - origin.y),
						origin.z + ratio * (target.z - origin.z),
						1.0
					);

					vertices[outsideIndices[0]].set(newV1);
					vertices.push(newV2);

					break;
				case 2:
					// Update the two outside vertices to their new positions on the near plane.
					// First vertex update
					var origin = vertices[outsideIndices[0]];
					var target = vertices[insideIndices[0]];

					var ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

					origin.x += ratio * (target.x - origin.x);
					origin.y += ratio * (target.y - origin.y);
					origin.z += ratio * (target.z - origin.z);


					// Second vertex update
					origin = vertices[outsideIndices[1]];
					ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

					origin.x += ratio * (target.x - origin.x);
					origin.y += ratio * (target.y - origin.y);
					origin.z += ratio * (target.z - origin.z);

					break;
			}

			// TODO : Combine projection + screen space transformations.
			this._projectionTransform(vertices, cameraProjectionMatrix);

			/* 
			if (this._isBackFacingProjected(v1, v2, v3)) {
				// TODO : Refactor to remove continue statement. acoording to Javascript : The Good Parts.
				continue; // Skip loop to the next three vertices.
			}
			*/

			this._transformToScreenSpace(vertices);

			this._createTriangles(vertices, outsideIndices, insideIndices, triangles);
		}

		return triangles;
	};

	/**
	*	Transforms the vertices with the given projection transform matrix and then performs the homogeneous division.
	*
	*	@param {Array.<Vector4>} vertices The vertex array
	*	@param {Matrix4x4} matrix The projection transformation matrix
	*/
	SoftwareRenderer.prototype._projectionTransform = function (vertices, matrix) {

		for (var i = 0; i < vertices.length; i++) {
			var v = vertices[i];

			matrix.applyPost(v);

			var div = 1.0 / v.w;
			v.x *= div;
			v.y *= div;
		}
	};

	/**
	*	Adds new triangle(s) to the triangle array. If the triangle has been clipped , the triangles are created from the vertex array in combination with the
	*	outsideIndices and insideIndices.
	*
	*	@param {Array.<Vector4>} vertices vertex array
	*	@param {Array.<Number>} outsideIndices
	*	@param {Array.<Number>} insideIndices
	*	@param {Array.<Triangle>} triangles the array to hold the created triangles.
	*/
	SoftwareRenderer.prototype._createTriangles = function (vertices, outsideIndices, insideIndices, triangles) {

		if (vertices.length === 4) {
			// The vertex array has a length 4 only if one of the vertices were outside the near plane.
			// The "extra vertex" is at position 3 in the array.

			// The order of the triangle is not relevant here anymore since
			// the backface culling check is made already.
			triangles.push(new Triangle(vertices[outsideIndices[0]], vertices[insideIndices[0]], vertices[3]));
			triangles.push(new Triangle(vertices[3], vertices[insideIndices[0]], vertices[insideIndices[1]]));

		} else {
			triangles.push(new Triangle(vertices[0], vertices[1], vertices[2]));
		}
	};

	/**
	*	Categorizes the vertices into outside and inside (of the view frustum).
	*	A vertex is categorized as being on the inside of the view frustum if it is located on the near plane.
	*	The outside- and insideIndices arrays are populated with the index to the vertex in question.
	*	@param {Array.<Number>} outsideIndices
	*	@param {Array.<Number>} insideIndices
	*	@param {Array.<Number>} vertices
	*	@param {Number} cameraNearPlane the camera near plane in world coordinates.
	*/
	SoftwareRenderer.prototype._categorizeVertices = function (outsideIndices, insideIndices, vertices, cameraNear) {

		for ( var i = 0; i < 3; i++ ) {
			// The vertex shall be categorized as an inside vertex if it is on the near plane.
			if (vertices[i].z <= cameraNear) {
				insideIndices.push(i);
			} else {
				outsideIndices.push(i);
			}
		}
	};

	/**
	*	Calculates the intersection ratio between the vector, created from the parameters origin and target, with the camera's near plane.
	*
	*	The ratio is defined as the amount (%), of the vector from origin to target, where the vector's intersection
	*	with the near plane happens.
	*
	*	Due to this intersection being performed in camera space, the ratio calculation can be simplified to
	*	only account for the z-coordinates.
	*
	*	@param {Vector3} origin
	*	@param {Vector3} target
	*	@param {Number} near The near plane.
	*/
	SoftwareRenderer.prototype._calculateIntersectionRatio = function (origin, target, near) {

		// Using a tip from Joel:
		// The intersection ratio can be calculated using the respective lenghts of the
		// endpoints (origin and target) to the near plane.
		// http://www.joelek.se/uploads/files/thesis.pdf, pages 28-31.

		// The camera's near plane component is the translation of the near plane,
		// therefore 'a' is caluclated as origin.z + near
		// var a = origin.z + near;
		// var b = -near - target.z;
		// var ratio = a/(a+b);

		// Simplified the ratio to :
		return (origin.z + near) / (origin.z - target.z);

	};

	/**
	*	Transforms the vertices' x and y coordinates into pixel coordinates of the screen.
	*	// TODO : This function should not be used in prod, rather combine the projection transform and this one.
	*	@param {Array.<Vector4>} vertexArray the vertices to be transformed.
	*/
	SoftwareRenderer.prototype._transformToScreenSpace = function (vertices) {

		for (var i = 0; i < vertices.length; i++) {

			var vertex = vertices[i];

			// These calculations assume that the camera's viewPortRight and viewPortTop are 1,
			// while the viewPortLeft and viewPortBottom are 0.
			// The x and y coordinates can still be outside the screen space here, but those will be clipped during rasterizing.
			// Transform to zerobasd interval of pixels instead of [0, width] which will be one pixel too much.
			// (Assuming the vertex values range from [-1, 1] when projected.)
			vertex.data[0] = (vertex.data[0] + 1.0) * (this._clipX / 2);
			vertex.data[1] = (vertex.data[1] + 1.0) * (this._clipY / 2);

			// http://www.altdevblogaday.com/2012/04/29/software-rasterizer-part-2/
			// The w-coordinate is the z-view at this point. Ranging from [0, cameraFar<].
			// During rendering, 1/w is used and saved as depth (float32). Values further than the far plane will render correctly.
		}
	};

	/**
	*	Determines if a triangle is backfacing in camera view space.
	*
	*	@param {Vector4} v1 Vertex #1
	*	@param {Vector4} v3 Vertex #2
	*	@param {Vector4} v3 Vertex #3
	*	@return {Boolean} true or false
	*/
	SoftwareRenderer.prototype._isBackFacingCameraViewSpace = function (v1, v2, v3) {

		// Calculate the dot product between the triangle's face normal and the camera's eye direction
		// to find out if the face is facing away or not.

		// Create edges for calculating the normal.
		var e1 = [v2.x - v1.x , v2.y - v1.y, v2.z - v1.z];
		var e2 = [v3.x - v1.x, v3.y - v1.y, v3.z - v1.z];

		// Doing the cross as well as dot product here since the built-in methods in Vector3 seems to do much error checking.
		var faceNormal = new Array(3);
		faceNormal[0] = e2[2] * e1[1] - e2[1] * e1[2];
		faceNormal[1] = e2[0] * e1[2] - e2[2] * e1[0];
		faceNormal[2] = e2[1] * e1[0] - e2[0] * e1[1];

		// Picking the first vertex as the point on the triangle to evaulate the dot product on.
		var viewVector = [v1.x, v1.y, v1.z];

		// No need to normalize the vectors due to only being
		// interested in the sign of the dot product.

		/*
		// Normalize faceNormal and view vector
		var viewLength = Math.sqrt(viewVector[0] * viewVector[0] + viewVector[1] * viewVector[1] + viewVector[2] * viewVector[2]);
		var faceLength = Math.sqrt(faceNormal[0] * faceNormal[0] + faceNormal[1] * faceNormal[1] + faceNormal[2] * faceNormal[2]);

		for (var i = 0; i < 3; i++) {
			viewVector[i] /= viewLength;
			faceNormal[i] /= faceLength;
		}
		*/

		var dot = faceNormal[0] * viewVector[0] + faceNormal[1] * viewVector[1] + faceNormal[2] * viewVector[2];
		return dot > 0.0;
	};

	/**
	*	Returns true if the (CCW) triangle created by the vertices v1, v2 and v3 is facing backwards.
	*	Otherwise false is returned. This method is for checking projected vertices.
	*
	*	@param {Vector4} v1 Vertex #1
	*	@param {Vector4} v3 Vertex #2
	*	@param {Vector4} v3 Vertex #3
	*	@return {Boolean} true or false
	*/
	SoftwareRenderer.prototype._isBackFacingProjected = function (v1, v2, v3) {

		// Optimized away edge allocation , only need x and y of the edges.
		var e1X = v2.data[0] - v1.data[0];
		var e1Y = v2.data[1] - v1.data[1];

		var e2X = v3.data[0] - v1.data[0];
		var e2Y = v3.data[1] - v1.data[1];

		var faceNormalZ = e2Y * e1X - e2X * e1Y;

		// The cameras eye direction will always be [0,0,-1] at this stage
		// (the vertices are transformed into the camera's view projection space,
		// thus the dot product can be simplified to only do multiplications on the z component.

		// var dotProduct = -faceNormal.z; // -1.0 * faceNormal.z;

		// Invert the comparison to remove the negation of facenormalZ.
		return faceNormalZ < 0.0;
	};

	SoftwareRenderer.prototype._renderTestTriangles = function () {

		for ( var i = 0; i < this.testTriangles.length; i++) {
			this._renderTriangle(this.testTriangles[i].toPixelSpace(this.width, this.height));
		}
	};

	/**
	*	Creates the new edges from the triangle. The returned value will be false if the triangle is outside view,
	*	otherwise the returned value is an array with the indices.
	*	@return {Array.<Number>} edgeIndexArray [longEdge, shortedge1, shortedge2, longEdgeIsOnTheRightSide]
	*/
	SoftwareRenderer.prototype._createEdgesForTriangle = function (triangle) {
		this._edges = [
			new Edge(triangle.v1, triangle.v2),
			new Edge(triangle.v2, triangle.v3),
			new Edge(triangle.v3, triangle.v1)
		];

		var maxHeight = 0;
		var longEdge = 0;

		// Find edge with the greatest height in the Y axis, this is the long edge.
		for(var i = 0; i < 3; i++) {
			var height = this._edges[i].y1 - this._edges[i].y0;
			if(height > maxHeight) {
				maxHeight = height;
				longEdge = i;
			}
		}

		// Vertical culling
		if (this._edges[longEdge].y1 < 0 || this._edges[longEdge].y0 > this.height) {
			// Triangle is outside the view, skipping rendering it;
			return false;
		}

		// "Next, we get the indices of the shorter edges, using the modulo operator to make sure that we stay within the bounds of the array:"
		var shortEdge1 = (longEdge + 1) % 3;
		var shortEdge2 = (longEdge + 2) % 3;

		// Find out which side the long edge is on.
		// This will be useful for determining which edge is on the left or right during scanline rendering.
		// The long edge is on the right side if the end x point is larger than that of one of the short edges.
		var isLongEdgeRightSide = this._edges[longEdge].x1 > this._edges[shortEdge1].x1 || this._edges[longEdge].x1 > this._edges[shortEdge2].x1;

		// Horizontal culling
		if (isLongEdgeRightSide) {
			if (this._edges[longEdge].x1 < 0 && this._edges[longEdge].x0 < 0) {
				return false;
			}
		} else {
			if (this._edges[longEdge].x1 > this._clipX && this._edges[longEdge].x0 > this._clipX) {
				return false;
			}
		}

		return [longEdge, shortEdge1, shortEdge2, isLongEdgeRightSide	];
	};

	SoftwareRenderer.prototype._isRenderedTriangleOccluded = function (triangle) {

		// returns [longEdge, shortEdge1, shortEdge2], or false on invisible triangle.
		var edgeIndexes = this._createEdgesForTriangle(triangle);

		if (!edgeIndexes) {
			return true;
		}

		// TODO :
        //	Conservative edge rounding , which takes into repsect if a triangle is facing inwards our outwards , seen from the left edge.
        //	When rounding the values of the triangles vertices , compensate the depth as well.
        //	These good ideas are sponsored by Martin Vilcans.
        for (var i = 0; i < 3; i++) {
			// TODO: Do pre-calculations here which are now performed in drawEdges.
			this._edges[i].roundOccludeeCoordinates();
			this._edges[i].invertZ();
        }

        var edgeData = this._edgePreRenderProcess(this._edges[edgeIndexes[0]], this._edges[edgeIndexes[1]]);
		if (edgeData) {
			if (!this._isEdgeOccluded(edgeData)){
				return false;
			}
		}

		edgeData = this._edgePreRenderProcess(this._edges[edgeIndexes[0]], this._edges[edgeIndexes[2]]);
		if (edgeData) {
			if (!this._isEdgeOccluded(edgeData)) {
				return false;
			}
		}

		return true;
	};

	/**
	*	Takes a triangle with coordinates in pixel space, and draws it.
	*	@param {Triangle} triangle the triangle to draw.
	*/
	SoftwareRenderer.prototype._renderTriangle = function (triangle) {

		// Original idea of triangle rasterization is taken from here : http://joshbeam.com/articles/triangle_rasterization/
		// The method is improved by using vertical coherence for each of the scanlines.

		// returns [longEdge, shortEdge1, shortEdge2];
		var edgeIndexes = this._createEdgesForTriangle(triangle);

		if (!edgeIndexes) {
			return;
		}

        // TODO : Find out which edge is the left and which is the right side of the short edges.

        // TODO :
        //	Conservative edge rounding , which takes into repsect if a triangle is facing inwards our outwards , seen from the left edge.
        //	When rounding the values of the triangles vertices , compensate the depth as well.
        //	These good ideas are sponsored by Martin Vilcans.

        for (var i = 0; i < 3; i++) {
			// TODO: Do pre-calculations here which are now performed in drawEdges.
			this._edges[i].roundOccluderCoordinates();
			this._edges[i].invertZ();
        }

        var edgeData = this._edgePreRenderProcess(this._edges[edgeIndexes[0]], this._edges[edgeIndexes[1]]);
		if (edgeData) {
			this._drawEdges(edgeData);
		}

		edgeData = this._edgePreRenderProcess(this._edges[edgeIndexes[0]], this._edges[edgeIndexes[2]]);
		if (edgeData) {
			this._drawEdges(edgeData);
		}
	};

	SoftwareRenderer.prototype._isEdgeOccluded = function(edgeData) {

		// Copypasted from _drawEdges.
		var leftX;
		var rightX;

		for (var y = edgeData[0]; y <= edgeData[1]; y++) {
			// Conservative rounding.
			leftX = Math.floor(edgeData[2]);
			rightX = Math.ceil(edgeData[3]);

			// Draw the span of pixels.
			if (!this._isScanlineOccluded(leftX, rightX, y, edgeData[4], edgeData[5])) {
				return false;
			}

			// Increase the edges'
			// x-coordinates and z-values with the increments.
			edgeData[2] += edgeData[6];
			edgeData[3] += edgeData[7];

			edgeData[4] += edgeData[8];
			edgeData[5] += edgeData[9];
		}

		return true;
	};

	/**
	*	Render the pixels between the long and the short edge of the triangle.
	*	@param {Edge} longEdge, shortEdge
	*/
	SoftwareRenderer.prototype._drawEdges = function (edgeData) {

		// [startLine, stopLine, longX, shortX, longZ, shortZ, longEdgeXincrement, shortEdgeXincrement, longEdgeZincrement, shortEdgeZincrement]

		var leftX;
		var rightX;

		// Fill pixels on every y-coordinate the short edge touches.
		for (var y = edgeData[0]; y <= edgeData[1]; y++) {
			// Round to the nearest pixel.
			leftX = Math.round(edgeData[2]);
			rightX = Math.round(edgeData[3]);

			// Draw the span of pixels.
			this._fillPixels(leftX, rightX, y, edgeData[4], edgeData[5]);

			// Increase the edges'
			// x-coordinates and z-values with the increments.
			edgeData[2] += edgeData[6];
			edgeData[3] += edgeData[7];

			edgeData[4] += edgeData[8];
			edgeData[5] += edgeData[9];
		}
	};

	/**
	*
	*/
	SoftwareRenderer.prototype._edgePreRenderProcess = function (longEdge, shortEdge) {

		// TODO: Move a lot of these calculations and variables into the Edge class,
		// do the calculations once for the long edge instead of twices as it is done now.

		// Early exit when the short edge doesnt have any height (y-axis).
		// -The edges' coordinates are stored as uint8, so compare with a SMI (SMall Integer, 31-bit signed integer) and not Double.

		var shortEdgeDeltaY = (shortEdge.y1 - shortEdge.y0);
		if(shortEdgeDeltaY <= 0) {
			return; // Nothing to draw here.
		}

		var longEdgeDeltaY = (longEdge.y1 - longEdge.y0);

		// Checking the long edge will probably be unneccessary, since if the short edge has no height, then the long edge must defenetly hasnt either?
		// Shouldn't be possible for the long edge to be of height 0 if any of the short edges has height.

		var longEdgeDeltaX = longEdge.x1 - longEdge.x0;
		var shortEdgeDeltaX = shortEdge.x1 - shortEdge.x0;

		var longStartZ = longEdge.z0;
		var shortStartZ = shortEdge.z0;
		var longEdgeDeltaZ = longEdge.z1 - longStartZ;
		var shortEdgeDeltaZ = shortEdge.z1 - shortStartZ;

		// Vertical coherence :
		// The x-coordinates' increment for each step in y is constant,
		// so the increments are pre-calculated and added to the coordinates
		// each scanline.

		// The scanline on which we start rendering on might be in the middle of the long edge,
		// the starting x-coordinate is therefore calculated.
		var longStartCoeff = (shortEdge.y0 - longEdge.y0) / longEdgeDeltaY;
		var longX = longEdge.x0 + longEdgeDeltaX * longStartCoeff;
		var longZ = longStartZ + longEdgeDeltaZ * longStartCoeff;
		var longEdgeXincrement = longEdgeDeltaX / longEdgeDeltaY;
		var longEdgeZincrement = longEdgeDeltaZ / longEdgeDeltaY;


		var shortX = shortEdge.x0;
		var shortZ = shortStartZ;
		var shortEdgeXincrement = shortEdgeDeltaX / shortEdgeDeltaY;
		var shortEdgeZincrement = shortEdgeDeltaZ / shortEdgeDeltaY;

		// TODO:
		// Implement this idea of checking which edge is the leftmost.
		// 1. Check if they start off at different positions, save the result and draw as usual
		// 2. If not, draw the first line and check again after this , the edges should now differ in x-coordinates.
		//    Save the result and draw the rest of the scanlines.

		var startLine = shortEdge.y0;
		var stopLine = shortEdge.y1;

		// Vertical clipping
		if (startLine < 0) {
			// If the starting line is above the screen space,
			// the starting x-coordinates has to be advanced to
			// the proper value.
			// And the starting line is then assigned to 0.
			startLine = -startLine;
			longX += startLine * longEdgeXincrement;
			shortX += startLine * shortEdgeXincrement;
			longZ += startLine * longEdgeZincrement;
			shortZ += startLine * shortEdgeZincrement;
			startLine = 0;
		}

		if (stopLine > this._clipY ) {
			stopLine = this._clipY;
		}

		return [startLine, stopLine, longX, shortX, longZ, shortZ, longEdgeXincrement, shortEdgeXincrement, longEdgeZincrement, shortEdgeZincrement];
	};

	SoftwareRenderer.prototype._isScanlineOccluded = function (leftX, rightX, y, leftZ, rightZ) {

		// 99% COPY PASTE FROM _fillPixels()! 

		// If the startindex is higher than the stopindex, they should be swapped.
		// TODO: This shall be optimized to be checked at an earlier stage.
		if (leftX > rightX) {
			var temp = leftX;
			leftX = rightX;
			rightX = temp;

			temp = leftZ;
			leftZ = rightZ;
			rightZ = temp;
		}

		if (rightX < 0 || leftX > this._clipX) {
			return true; // Nothing to draw here. it is occluded
		}

		// Horizontal clipping
		var t;
		// If the triangle's scanline is clipped, the bounding z-values have to be interpolated
		// to the new startpoints.
		if (leftX < 0) {
			t = -leftX / (rightX - leftX);
			leftZ = (1.0 - t) * leftZ + t * rightZ;
			leftX = 0;
		}

		var diff = rightX - this._clipX;
		if (diff > 0) {
			t = diff / (rightX - leftX);
			rightZ = (1.0 - t) * rightZ + t * leftZ;
			rightX = this._clipX;
		}

		var index = y * this.width + leftX;
		var depth = leftZ;
		var depthIncrement = (rightZ - leftZ) / (rightX - leftX);
		// Fill all pixels in the interval [leftX, rightX].
		for (var i = leftX; i <= rightX; i++) {

			// TODO : Remove this debugg add of color in prod....
			this._colorData.set([Math.min(depth * 255 + 50, 255), 0, 0], index * 4);

			// Check if the value is closer than the stored one. z-test.
			if (depth > this._depthData[index]) {
				// Not occluded
				return false;
			}

			index++;
			depth += depthIncrement;
		}
		// Occluded
		return true;
	};

	/**
	*	Writes the span of pixels to the depthData. The pixels written are
	*	the closed interval of [leftX, rightX] on the y-coordinte y.
	*
	*/
	SoftwareRenderer.prototype._fillPixels = function (leftX, rightX, y, leftZ, rightZ) {

		// If the startindex is higher than the stopindex, they should be swapped.
		// TODO: This shall be optimized to be checked at an earlier stage.
		if (leftX > rightX) {
			var temp = leftX;
			leftX = rightX;
			rightX = temp;

			temp = leftZ;
			leftZ = rightZ;
			rightZ = temp;
		}

		if (rightX < 0 || leftX > this._clipX) {
			return false; // Nothing to draw here.
		}

		// Horizontal clipping
		var t;
		// If the triangle's scanline is clipped, the bounding z-values have to be interpolated
		// to the new startpoints.
		if (leftX < 0) {
			t = -leftX / (rightX - leftX);
			leftZ = (1.0 - t) * leftZ + t * rightZ;
			leftX = 0;
		}

		var diff = rightX - this._clipX;
		if (diff > 0) {
			t = diff / (rightX - leftX);
			rightZ = (1.0 - t) * rightZ + t * leftZ;
			rightX = this._clipX;
		}

		var index = y * this.width + leftX;
		var depth = leftZ;
		var depthIncrement = (rightZ - leftZ) / (rightX - leftX);
		// Fill all pixels in the interval [leftX, rightX].
		for (var i = leftX; i <= rightX; i++) {

			// Check if the value is closer than the stored one. z-test.
			if (depth > this._depthData[index]) {
				this._depthData[index] = depth;  // Store 1/w values in range [1/far, 1/near].
			}

			index++;
			depth += depthIncrement;
		}

		/*
		var lastDepth = depth - depthIncrement;
		if ( Math.abs(lastDepth - rightZ) >= 0.0000000001 && rightX - leftX > 0) {
			console.error("Wrong depth interpolation!");
			console.log("lastdepth", lastDepth);
			console.log("rightZ", rightZ);
			console.log("depthIncrement", depthIncrement);
		}
		*/
	};

	/**
	*	Maps the data in the depth buffer to gray scale values in the color buffer.
	*/
	SoftwareRenderer.prototype.copyDepthToColor = function () {

		var colorIndex = 0;

		for(var i = 0; i < this._depthData.length; i++) {

			// Convert the float value of depth into 8bit.
			var depth = this._depthData[i] * 255;
			this._colorData[colorIndex] = depth;
			this._colorData[++colorIndex] = depth;
			this._colorData[++colorIndex] = depth;
			this._colorData[++colorIndex] = 255;
			colorIndex++;
		}
	};


	/**
	*	Returns the array of RGBA color data.
	*	@return {Uint8Array} RGBA Color data.
	*/
	SoftwareRenderer.prototype.getColorData = function () {
		return this._colorData;
	};

	/**
	*	Returns the array of depth data.
	*	@return {Float32Array} Depth data.
	*/
	SoftwareRenderer.prototype.getDepthData = function () {

		return this._depthData;
	};


	SoftwareRenderer.prototype.calculateDifference = function (webGLColorData, clearColor) {
		for (var i in this._depthData) {
			var depthvalue = this._depthData[i];

			var colorIndex = 4 * i;
			var R = webGLColorData[colorIndex];
			var G = webGLColorData[colorIndex + 1];
			var B = webGLColorData[colorIndex + 2];
			var A = webGLColorData[colorIndex + 3];
			// Make a red pixel if there is depth where there is no color in any channel except for the clear color value for that channel. (There is difference at this location)
			if (depthvalue > 0.0 && !(R > clearColor[0] * 256 || G > clearColor[1] * 256 || B > clearColor[2] * 256 || A > clearColor[3] * 256)) {
				this._colorData[colorIndex] = 255;
				this._colorData[colorIndex + 1] = 0;
				this._colorData[colorIndex + 2] = 0;
				this._colorData[colorIndex + 3] = 255;
			}
		}
	};

	return SoftwareRenderer;
});
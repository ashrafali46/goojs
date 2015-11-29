goo.TimelineComponent=function(e){"use strict";function t(){e.apply(this,arguments),this.type="TimelineComponent",this.channels=[],this.time=0,this.duration=0,this.loop=!1}return t.prototype=Object.create(e.prototype),t.prototype.constructor=t,t.prototype.addChannel=function(e){return this.channels.push(e),this},t.prototype.update=function(e){var t=this.time+e;if(t>this.duration&&(this.loop?t%=this.duration:t=this.duration),t===this.time)return this;this.time=t;for(var n=0;n<this.channels.length;n++){var i=this.channels[n];i.update(this.time)}return this},t.prototype.setTime=function(e){this.time=e;for(var t=0;t<this.channels.length;t++){var n=this.channels[t];n.setTime(this.time)}return this},t.prototype.getValues=function(){for(var e={},t=0;t<this.channels.length;t++){var n=this.channels[t];"undefined"!=typeof n.value&&n.keyframes.length&&(e[n.id]=n.value)}return e},t}(goo.Component),goo.AbstractTimelineChannel=function(){"use strict";function e(e){this.id=e,this.enabled=!0,this.keyframes=[],this.lastTime=0}return e.prototype._find=function(e,t){var n=0,i=e.length-1,r=e[e.length-1].time;if(t>r)return i;for(;i-n>1;){var o=Math.floor((i+n)/2),a=e[o].time;t>a?n=o:i=o}return n},e.prototype.sort=function(){return this.keyframes.sort(function(e,t){return e.time-t.time}),this.lastTime=this.keyframes[this.keyframes.length-1].time,this},e}(),goo.ValueChannel=function(e,t){"use strict";function n(t,n){e.call(this,t),this.value=0,n=n||{},this.callbackUpdate=n.callbackUpdate,this.callbackEnd=n.callbackEnd}return n.prototype=Object.create(e.prototype),n.prototype.constructor=n,n.prototype.addKeyframe=function(e,t,n,i){var r={id:e,time:t,value:n,easingFunction:i};if(t>this.lastTime)this.keyframes.push(r),this.lastTime=t;else if(!this.keyframes.length||t<this.keyframes[0].time)this.keyframes.unshift(r);else{var o=this._find(this.keyframes,t)+1;this.keyframes.splice(o,0,r)}return this},n.prototype.update=function(e){if(!this.enabled)return this.value;if(!this.keyframes.length)return this.value;var n,i;if(e<=this.keyframes[0].time)n=this.keyframes[0].value;else if(e>=this.keyframes[this.keyframes.length-1].time)n=this.keyframes[this.keyframes.length-1].value;else{i=this._find(this.keyframes,e);var r=this.keyframes[i],o=this.keyframes[i+1],a=(e-r.time)/(o.time-r.time),s=r.easingFunction(a);n=t.lerp(s,r.value,o.value)}return this.value=n,this.callbackUpdate(e,this.value,i),this},n.prototype.setTime=n.prototype.update,n.getSimpleTransformTweener=function(e,t,n,i){var r;return function(o,a){r||(r=i(n)),r&&(r.transformComponent.transform[e][t]=a,r.transformComponent.setUpdated())}},n.getRotationTweener=function(e,n,i,r){var o,a=function(r,s){if(o||(o=i(n)),o){var l=a.rotation;l[e]=s*t.DEG_TO_RAD,o.transformComponent.transform.rotation.fromAngles(l[0],l[1],l[2]),o.transformComponent.setUpdated()}};return a.rotation=r,a},n}(goo.AbstractTimelineChannel,goo.MathUtils),goo.EventChannel=function(e){"use strict";function t(t){e.call(this,t),this.oldTime=0,this.callbackIndex=0}return t.prototype=Object.create(e.prototype),t.prototype.constructor=e,t.prototype.addCallback=function(e,t,n){var i={id:e,time:t,callback:n};if(t>this.lastTime)this.keyframes.push(i),this.lastTime=t;else if(!this.keyframes.length||t<this.keyframes[0].time)this.keyframes.unshift(i);else{var r=this._find(this.keyframes,t)+1;this.keyframes.splice(r,0,i)}return this},t.prototype.update=function(e){if(!this.enabled)return this;if(!this.keyframes.length)return this;if(e<this.oldTime){for(;this.callbackIndex<this.keyframes.length;)this.keyframes[this.callbackIndex].callback(),this.callbackIndex++;this.callbackIndex=0}for(;this.callbackIndex<this.keyframes.length&&e>this.keyframes[this.callbackIndex].time;)this.keyframes[this.callbackIndex].callback(),this.callbackIndex++;return this.oldTime=e,this},t.prototype.setTime=function(e){return this.enabled&&this.keyframes.length?(e<=this.keyframes[0].time?this.callbackIndex=0:this.callbackIndex=this._find(this.keyframes,e)+1,this.oldTime=e,this):this},t}(goo.AbstractTimelineChannel),goo.TimelineComponentHandler=function(e,t,n,i,r,o,a,s){"use strict";function l(){e.apply(this,arguments),this._type="TimelineComponent"}function h(e){if(!e)return s.Easing.Linear.None;var t=e.indexOf("."),n=e.substr(0,t),i=e.substr(t+1);return s.Easing[n][i]}function u(e,t,n){var i=!1,o=r.find(n.keyframes,function(e){return e.id===t}),a=h(e.easing);return o?(o.time!==+e.time&&(i=!0),o.time=+e.time,o.value=+e.value,o.easingFunction=a):n.addKeyframe(t,e.time,e.value,a),{needsResorting:i}}function c(e,t,n,i){var a=!1,s=r.find(n.keyframes,function(e){return e.id===t}),l=function(){o.emit(i.eventName,e.value)};return s?(s.time!==+e.time&&(a=!0),s.time=+e.time,s.callback=l):n.addCallback(t,e.time,l),{needsResorting:a}}function m(e,t,o,a,s){var h=r.find(o.channels,function(e){return e.id===t});if(h){if(e.entityId&&h.callbackUpdate&&h.callbackUpdate.rotation){var m=s[e.entityId]=h.callbackUpdate.rotation;m[0]=0,m[1]=0,m[2]=0}}else{var f=e.propertyKey;if(f){var p=e.entityId;p&&!s[p]&&(s[p]=[0,0,0]);var d=l.tweenMap[f](p,a,s[p]);h=new n(t,{callbackUpdate:d})}else h=new i(t);o.channels.push(h)}h.enabled=e.enabled!==!1,h.keyframes=h.keyframes.filter(function(t){return!!e.keyframes[t.id]});var y=!1;if(e.propertyKey)for(var g in e.keyframes){var k=e.keyframes[g],v=u(k,g,h,e);y=y||v.needsResorting}else for(var g in e.keyframes){var k=e.keyframes[g],v=c(k,g,h,e);y=y||v.needsResorting}y&&h.sort()}return l.prototype=Object.create(e.prototype),l.prototype.constructor=l,e._registerClass("timeline",l),l.prototype._prepare=function(){},l.prototype._create=function(){return new t},l.tweenMap={translationX:n.getSimpleTransformTweener.bind(null,"translation","x"),translationY:n.getSimpleTransformTweener.bind(null,"translation","y"),translationZ:n.getSimpleTransformTweener.bind(null,"translation","z"),scaleX:n.getSimpleTransformTweener.bind(null,"scale","x"),scaleY:n.getSimpleTransformTweener.bind(null,"scale","y"),scaleZ:n.getSimpleTransformTweener.bind(null,"scale","z"),rotationX:n.getRotationTweener.bind(null,0),rotationY:n.getRotationTweener.bind(null,1),rotationZ:n.getRotationTweener.bind(null,2)},l.prototype.update=function(t,n,i){var r=this;return e.prototype.update.call(this,t,n,i).then(function(e){if(e){isNaN(n.duration)||(e.duration=+n.duration),e.loop=n.loop.enabled===!0,e.channels=e.channels.filter(function(e){return!!n.channels[e.id]});var t=function(e){return r.world.entityManager.getEntityById(e)},i={};return a.forEach(n.channels,function(n){m(n,n.id,e,t,i)},null,"sortValue"),e}})},l}(goo.ComponentHandler,goo.TimelineComponent,goo.ValueChannel,goo.EventChannel,goo.ArrayUtils,goo.SystemBus,goo.ObjectUtils,goo.TWEEN),goo.TimelineSystem=function(e,t){"use strict";function n(){e.call(this,"TimelineSystem",["TimelineComponent"])}return n.prototype=Object.create(e.prototype),n.prototype.constructor=n,n.prototype.process=function(e,n){if(this.resetRequest){var i;this.resetRequest=!1;for(var r=0;r<e.length;r++)i=e[r].timelineComponent,i.setTime(0);return this.time=0,t.removeAll(),void(this.passive=!0)}for(var r=0;r<this._activeEntities.length;r++){var o=this._activeEntities[r];o.timelineComponent.update(n)}},n.prototype.play=function(){this.passive=!1,this.paused||(this.entered=!0),this.paused=!1},n.prototype.pause=function(){this.passive=!0,this.paused=!0},n.prototype.resume=n.prototype.play,n.prototype.stop=function(){this.passive=!1,this.resetRequest=!0,this.paused=!1},n}(goo.System,goo.TWEEN),"function"==typeof require&&(define("goo/timelinepack/TimelineComponent",[],function(){return goo.TimelineComponent}),define("goo/timelinepack/AbstractTimelineChannel",[],function(){return goo.AbstractTimelineChannel}),define("goo/timelinepack/ValueChannel",[],function(){return goo.ValueChannel}),define("goo/timelinepack/EventChannel",[],function(){return goo.EventChannel}),define("goo/timelinepack/TimelineComponentHandler",[],function(){return goo.TimelineComponentHandler}),define("goo/timelinepack/TimelineSystem",[],function(){return goo.TimelineSystem}));
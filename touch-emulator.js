/*
 * Optional touch-to-mouse bridge for web games that only listen for mouse
 * events. It is intentionally opt-in because modern games generally handle
 * touch or pointer events themselves.
 */
(function () {
    'use strict';

    if (window.__webPackerTouchEmulatorLoaded) return;
    window.__webPackerTouchEmulatorLoaded = true;

    var activeTouchId = null;
    var activeTarget = null;
    var lastX = 0;
    var lastY = 0;
    var moved = false;

    function dispatchMouse(type, target, touch) {
        if (!target || !touch) return;
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            screenX: touch.screenX,
            screenY: touch.screenY,
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0,
            buttons: type === 'mouseup' || type === 'click' ? 0 : 1
        }));
    }

    function getActiveTouch(touches) {
        for (var i = 0; i < touches.length; i += 1) {
            if (touches[i].identifier === activeTouchId) return touches[i];
        }
        return null;
    }

    document.addEventListener('touchstart', function (event) {
        if (activeTouchId !== null || !event.changedTouches.length) return;
        var touch = event.changedTouches[0];
        activeTouchId = touch.identifier;
        activeTarget = document.elementFromPoint(touch.clientX, touch.clientY) || event.target;
        lastX = touch.clientX;
        lastY = touch.clientY;
        moved = false;
        dispatchMouse('mousemove', activeTarget, touch);
        dispatchMouse('mousedown', activeTarget, touch);
    }, true);

    document.addEventListener('touchmove', function (event) {
        var touch = getActiveTouch(event.changedTouches);
        if (!touch || !activeTarget) return;
        if (Math.abs(touch.clientX - lastX) > 6 || Math.abs(touch.clientY - lastY) > 6) {
            moved = true;
        }
        lastX = touch.clientX;
        lastY = touch.clientY;
        dispatchMouse('mousemove', activeTarget, touch);
    }, true);

    function finishTouch(event, cancelled) {
        var touch = getActiveTouch(event.changedTouches);
        if (!touch || !activeTarget) return;
        dispatchMouse('mouseup', activeTarget, touch);
        if (!cancelled && !moved) dispatchMouse('click', activeTarget, touch);
        activeTouchId = null;
        activeTarget = null;
    }

    document.addEventListener('touchend', function (event) {
        finishTouch(event, false);
    }, true);
    document.addEventListener('touchcancel', function (event) {
        finishTouch(event, true);
    }, true);
}());

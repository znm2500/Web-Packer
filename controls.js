(function () {
    // Inject CSS
    const style = document.createElement('style');
    style.innerHTML = `
        html, body {
            touch-action: none;
        }
        #mk-canvas {
            position: fixed;
            pointer-events: none;
            image-rendering: pixelated;
            z-index: 999999;
            transform-origin: top left;
        }
        #mk-canvas.hidden {
            display: none;
            pointer-events: none;
        }
        .no-mouse-sim,
        #error,
        #error * {
            touch-action: auto;
        }
    `;
    document.head.appendChild(style);

    // Create mk-canvas
    const mkCanvas = document.createElement('canvas');
    mkCanvas.id = 'mk-canvas';
    mkCanvas.className = 'hidden';
    mkCanvas.width = 640;
    mkCanvas.height = 480;
    document.body.appendChild(mkCanvas);


    (function () {
        const cursor = document.createElement('div');

        const mouse = {
            x: 0,
            y: 0,
            isDown: false,
            activeElement: null,
            moved: false,
            visible: false,
            touchId: null
        };

        function updateCursor(x, y) {
            cursor.style.left = x + 'px';
            cursor.style.top = y + 'px';
            mouse.x = x;
            mouse.y = y;
        }

        function dispatchMouseEvent(target, type, x, y) {
            const event = new MouseEvent(type, {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                screenX: x + window.screenX,
                screenY: y + window.screenY,
                button: 0,
                buttons: mouse.isDown ? 1 : 0
            });
            target.dispatchEvent(event);
        }

        function getElementFromPoint(x, y) {
            return document.elementFromPoint(x, y);
        }

        document.addEventListener('touchstart', function (e) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target && (target.closest('.no-mouse-sim') || target.closest('#error'))) {
                    continue;
                }

                if (mkEnabled && scratchReady && typeof isTouchOnControl === 'function') {
                    const guiPos = toGUI(touch);
                    if (isTouchOnControl(guiPos.x, guiPos.y) || edit !== 0) {
                        continue;
                    }
                }

                e.preventDefault();
                mouse.touchId = touch.identifier;
                updateCursor(touch.clientX, touch.clientY);
                cursor.style.display = 'block';
                mouse.visible = true;
                mouse.isDown = true;
                mouse.moved = false;
                mouse.activeElement = getElementFromPoint(mouse.x, mouse.y);

                if (mouse.activeElement) {
                    dispatchMouseEvent(mouse.activeElement, 'mousemove', mouse.x, mouse.y);
                    dispatchMouseEvent(mouse.activeElement, 'mousedown', mouse.x, mouse.y);
                }
                break;
            }
        }, { passive: false });

        document.addEventListener('touchmove', function (e) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier !== mouse.touchId) continue;
                
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target && (target.closest('.no-mouse-sim') || target.closest('#error'))) {
                    continue;
                }

                e.preventDefault();
                updateCursor(touch.clientX, touch.clientY);
                mouse.moved = true;

                const newElement = getElementFromPoint(mouse.x, mouse.y);

                if (mouse.activeElement && newElement !== mouse.activeElement) {
                    dispatchMouseEvent(mouse.activeElement, 'mouseleave', mouse.x, mouse.y);
                    dispatchMouseEvent(newElement, 'mouseenter', mouse.x, mouse.y);
                }

                mouse.activeElement = newElement;

                if (mouse.activeElement) {
                    dispatchMouseEvent(mouse.activeElement, 'mousemove', mouse.x, mouse.y);

                }
                break;
            }
        }, { passive: false });

        document.addEventListener('touchend', function (e) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier !== mouse.touchId) continue;
                
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target && (target.closest('.no-mouse-sim') || target.closest('#error'))) {
                    continue;
                }

                e.preventDefault();
                updateCursor(touch.clientX, touch.clientY);
                const finalElement = getElementFromPoint(mouse.x, mouse.y);

                if (mouse.moved && mouse.activeElement) {
                    dispatchMouseEvent(mouse.activeElement, 'mouseup', mouse.x, mouse.y);
                } else if (finalElement) {
                    dispatchMouseEvent(finalElement, 'mouseup', mouse.x, mouse.y);
                    dispatchMouseEvent(finalElement, 'click', mouse.x, mouse.y);
                }

                mouse.isDown = false;
                mouse.activeElement = null;
                mouse.moved = false;
                mouse.visible = false;
                mouse.touchId = null;
                cursor.style.display = 'none';
                break;
            }
        }, { passive: false });

        document.addEventListener('mousemove', function (e) {
            if (!mouse.visible) {
                updateCursor(e.clientX, e.clientY);
            }
        });
    })();

    function getScratchCanvas() {
        return document.querySelector('canvas.sc-canvas') ||
            document.querySelector('canvas.sc-stage') ||
            document.querySelector('canvas#scratch-stage') ||
            document.querySelector('canvas:not(#mk-canvas)');
    }

    let audioCtx = null;
    const audioBuffers = {};

    // Tenta inicializar o áudio automaticamente assim que a página estiver pronta
    function tryAutoInitAudio() {
        if (!audioCtx) {
            initAudio().catch(function(){});
        } else if (audioCtx.state === 'suspended' && !gameIsPaused) {
            audioCtx.resume().catch(function(){});
        }
    }

    function xhrArrayBuffer(url) {
        if (url.startsWith('data:')) {
            return new Promise(function (resolve, reject) {
                try {
                    const b64 = url.split(',')[1];
                    const bin = atob(b64);
                    const buf = new ArrayBuffer(bin.length);
                    const view = new Uint8Array(buf);
                    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
                    resolve(buf);
                } catch (e) { reject(e); }
            });
        }
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function () { resolve(xhr.response); };
            xhr.onerror = function () { reject(new Error('XHR error: ' + url)); };
            xhr.send();
        });
    }

    function initAudio() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended' && !gameIsPaused) audioCtx.resume();
            return Promise.resolve();
        }

        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Tenta desbloquear imediatamente reproduzindo um buffer silencioso
            (function unlockAudio() {
                if (!audioCtx || audioCtx.state !== 'suspended') return;
                const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
                const src = audioCtx.createBufferSource();
                src.buffer = buf;
                src.connect(audioCtx.destination);
                src.start(0);
                audioCtx.resume().catch(function(){});
            })();
        } catch (e) {
            console.warn('MK AudioContext creation failed:', e);
            return Promise.resolve();
        }
        const files = {
            enable: 'data:audio/ogg;base64,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',
            disable: 'data:audio/wav;base64,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7//u/+7/7//w//H/8P/w//H/8f/x//H/8f/y//L/8v/y//L/8//z//P/8//z//T/9P/0//P/9P/1//X/9f/1//X/9f/2//b/9v/2//X/9f/3//f/9//3//f/9//5//j/+P/4//j/+P/4//n/+P/5//n/+f/5//j/+f/6//r/+v/6//r/+v/7//r/+//6//v/+//7//v/+//7//z//P/9//z//P/8//z//P/7//z//P/9//3//P/9//3//f/9//3//f/9//3//f////7//v/9//7//v/+//7//v/+//7//f/+//7//////wAA/////////////////v///////////////v8AAAAAAQD//wAAAAAAAAAAAAAAAAAAAAABAAAA//8AAAAAAAAAAAAAAAACAAEAAgABAAEAAgAAAAIAAQABAAIAAAABAAEAAQABAAIAAQABAAEAAQAAAAEAAQACAAEAAQABAAEAAgADAAIAAgADAAIAAgACAAIAAgACAAMAAgACAAIAAgACAAMAAgABAAIAAQACAAIAAgACAAMAAgACAAIAAgABAAIAAgACAAIAAgADAAIAAgACAAIAAgACAAMAAgACAAMAAgABAAIAAgACAAIAAgACAAIAAgACAAIAAgADAAMAAwADAAMAAwADAAMABAADAAMAAwACAAMAAwADAAQAAwADAAMAAwADAAMAAwADAAMAAwAEAAQABAACAAQAAwADAAMAAwADAAQAAwADAAMABAADAAMAAwADAAMAAwACAAMAAwAEAAQAAwADAAMABAADAAMAAwADAAQAAwADAAIAAwADAAQAAwACAAMAAgADAAMAAwACAAMAAwADAAMAAwADAAMAAgADAAIAAgADAAIAAwAEAAQAAwADAAMABAADAAMAAwADAAMAAwADAAMAAwADAAQAAwADAAMABAADAAQAAwACAAMAAwADAAMAAwADAAQAAwACAAIAAgABAAIAAQACAAIAAgABAAIAAgACAAIAAwABAAIAAgACAAMAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAwACAAIAAgABAAIAAgACAAEAAgACAAIAAwABAAMAAgACAAMAAwACAAEAAgACAAIAAgACAAIAAwACAAIAAgACAAIAAQACAAIAAgADAAIAAQACAAEAAQACAAIAAgACAAIAAgACAAIAAgACAAIAAgADAAIAAgACAAMAAgACAAMAAgACAAIAAQACAAMAAgADAAIAAgACAAIAAwACAAIAAgACAAIAAgADAAIAAwACAAIAAwACAAIAAQABAAIAAgABAAIAAgACAAIAAgABAAIAAgABAAIAAwACAAIAAgACAAIAAgABAAMAAgABAAIAAgABAAIAAgACAAEAAQACAAIAAgACAAIAAgADAAIAAgABAAEAAQABAAIAAgACAAIAAgABAAIAAAABAAEAAAABAAIAAQAAAAIAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAgABAAIAAQABAAEAAQACAAAAAQABAAEAAQABAAEAAQABAAEAAAABAAEAAQABAAEAAAABAAEAAQABAAEAAQABAAEAAAABAAEAAQACAAEAAQABAAEAAQAAAAEAAgACAAIAAQABAAEAAQABAAAAAgAAAAEAAQABAAEAAQABAAEAAQABAAEAAQAAAAEAAQACAAEAAQABAAAAAQABAAIAAQABAAEAAQABAAEAAQABAAEAAAABAAEAAgABAAIAAQAAAAEAAgABAAIAAQABAAEAAQAAAAEAAQAAAAEAAAABAAEAAAACAAEAAQAAAAEAAQABAAEAAQABAAEAAAABAAAAAQAAAAEAAgACAAAAAQAAAAEAAgABAAEAAQABAAEAAgACAAEAAQAAAAIAAQACAAEAAQABAAEAAgABAAEAAQABAAEAAQAAAAEAAQABAAAAAQABAAEAAQACAAEAAAABAAIAAQABAAEAAQABAAIAAgABAAAAAgACAAAAAQABAAEAAQABAAEAAQABAAEAAQABAAIAAQABAAEAAQABAAEAAQABAAEAAAABAAEAAQABAAEAAAABAAEAAQABAAEAAQABAAEAAQABAAEAAAAAAAEAAQABAAIAAQACAAEAAQABAAIAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAD//wAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAP//AAD//wEAAAD//wAAAAAAAP//AAAAAP//AAAAAAAAAQAAAAAAAAD//wAAAAAAAAAAAAABAAAAAAABAAAA//8AAAAAAAD/////AAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAP//AAAAAAEAAAABAAAA//8AAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAQABAP//AAAAAAAAAAAAAAAAAAD/////AAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAEAAQAAAAAAAAAAAAAAAAABAAEAAAAAAAEA//8AAAAAAQABAAAAAAD//wAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAAAA//////////8AAP//AAAAAAAAAAD/////AAD//wEAAQAAAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAABAAAAAAAAAP//AAAAAAAA//8AAAAAAAAAAAAAAQAAAAAAAQAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAABAAAA//8AAAAAAAAAAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQD//wAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAQAAAP//AAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAA//8AAAEAAAABAAAAAAABAAAAAAAAAAAA//8AAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAABAAAA////////AAAAAP////8AAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAEA//8BAAAAAAAAAAAAAQAAAAAAAAAAAP//AAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAQAAAP//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAABAP//AAAAAAEAAAABAAEAAAABAAAA//8AAAAAAAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAAAAAEAAAAAAP//AAAAAAAAAAAAAP//AAABAAAAAQAAAAAAAAAAAP//AAABAAAAAAAAAAAAAAAAAAAAAAABAAAAAAABAAAAAQD//wAAAAAAAP//AAAAAP//AQAAAAAAAQAAAAAA//8AAAEA/////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAAEAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAAAAP//AAAAAAAAAAAAAAAAAAD//wEAAAD//wAAAAAAAP//AAAAAAAAAAAAAAAA//8AAP//AQAAAAAAAAABAAAAAAABAAAAAAAAAAEAAQAAAAAAAQAAAAAAAAABAAAA//8AAAAAAAABAP//AAAAAAAAAAAAAAAAAAAAAP//AQAAAAEAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAABAAEAAAD//wAAAAD//wAAAAAAAAEAAAAAAAEAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAABAP//AAD//wEAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAD//wEAAAAAAAAAAQAAAAEAAQAAAAAAAAAAAAAA//8AAP///////wAAAAAAAAEAAQAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAD//wAAAAAAAAAAAQAAAP//AAAAAAAA////////AAAAAAAAAAAAAP//AAD//wAAAQABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAAAAAAEAAAAAAAEAAAABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAAD//wAA//8AAAAAAAD//wAAAAAAAP//AAAAAAEA//8BAAAAAAABAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAP//AQAAAAAAAAABAAAAAAAAAP//AAAAAAAA//8AAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAQAAAAAAAAAAAP//AAAAAAAAAAAAAAAA//8AAAEA//8BAAAAAAD//wAAAAABAAAAAAAAAAAAAAAAAAEA//8AAAAAAQAAAAAAAAD//wAAAAAAAAAAAQAAAAAAAAAAAAEAAAAAAAAAAAABAAEAAAAAAP//AAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAQAAAAAAAAABAAAAAQAAAAAAAAAAAP//AAD//wAA//8AAAAAAAD//wAA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',
            snd_coin_mobile: 'data:audio/ogg;base64,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',
            snd_egg_mobile: 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAACXJFxwAAAAAF37TAQBHgF2b3JiaXMAAAAAAUSsAAAAAAAAgDgBAAAAAAC4AU9nZ1MAAAAAAAAAAAAAlyRccAEAAABrOqUwDkD///////////////+BA3ZvcmJpcw0AAABMYXZmNTYuMzguMTAyAQAAAB8AAABlbmNvZGVyPUxhdmM1Ni40NS4xMDAgbGlidm9yYmlzAQV2b3JiaXMiQkNWAQBAAAAkcxgqRqVzFoQQGkJQGeMcQs5r7BlCTBGCHDJMW8slc5AhpKBCiFsogdCQVQAAQAAAh0F4FISKQQghhCU9WJKDJz0IIYSIOXgUhGlBCCGEEEIIIYQQQgghhEU5aJKDJ0EIHYTjMDgMg+U4+ByERTlYEIMnQegghA9CuJqDrDkIIYQkNUhQgwY56ByEwiwoioLEMLgWhAQ1KIyC5DDI1IMLQoiag0k1+BqEZ0F4FoRpQQghhCRBSJCDBkHIGIRGQViSgwY5uBSEy0GoGoQqOQgfhCA0ZBUAkAAAoKIoiqIoChAasgoAyAAAEEBRFMdxHMmRHMmxHAsIDVkFAAABAAgAAKBIiqRIjuRIkiRZkiVZkiVZkuaJqizLsizLsizLMhAasgoASAAAUFEMRXEUBwgNWQUAZAAACKA4iqVYiqVoiueIjgiEhqwCAIAAAAQAABA0Q1M8R5REz1RV17Zt27Zt27Zt27Zt27ZtW5ZlGQgNWQUAQAAAENJpZqkGiDADGQZCQ1YBAAgAAIARijDEgNCQVQAAQAAAgBhKDqIJrTnfnOOgWQ6aSrE5HZxItXmSm4q5Oeecc87J5pwxzjnnnKKcWQyaCa0555zEoFkKmgmtOeecJ7F50JoqrTnnnHHO6WCcEcY555wmrXmQmo21OeecBa1pjppLsTnnnEi5eVKbS7U555xzzjnnnHPOOeec6sXpHJwTzjnnnKi9uZab0MU555xPxunenBDOOeecc84555xzzjnnnCA0ZBUAAAQAQBCGjWHcKQjS52ggRhFiGjLpQffoMAkag5xC6tHoaKSUOggllXFSSicIDVkFAAACAEAIIYUUUkghhRRSSCGFFGKIIYYYcsopp6CCSiqpqKKMMssss8wyyyyzzDrsrLMOOwwxxBBDK63EUlNtNdZYa+4555qDtFZaa621UkoppZRSCkJDVgEAIAAABEIGGWSQUUghhRRiiCmnnHIKKqiA0JBVAAAgAIAAAAAAT/Ic0REd0REd0REd0REd0fEczxElURIlURIt0zI101NFVXVl15Z1Wbd9W9iFXfd93fd93fh1YViWZVmWZVmWZVmWZVmWZVmWIDRkFQAAAgAAIIQQQkghhRRSSCnGGHPMOegklBAIDVkFAAACAAgAAABwFEdxHMmRHEmyJEvSJM3SLE/zNE8TPVEURdM0VdEVXVE3bVE2ZdM1XVM2XVVWbVeWbVu2dduXZdv3fd/3fd/3fd/3fd/3fV0HQkNWAQASAAA6kiMpkiIpkuM4jiRJQGjIKgBABgBAAACK4iiO4ziSJEmSJWmSZ3mWqJma6ZmeKqpAaMgqAAAQAEAAAAAAAACKpniKqXiKqHiO6IiSaJmWqKmaK8qm7Lqu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67quC4SGrAIAJAAAdCRHciRHUiRFUiRHcoDQkFUAgAwAgAAAHMMxJEVyLMvSNE/zNE8TPdETPdNTRVd0gdCQVQAAIACAAAAAAAAADMmwFMvRHE0SJdVSLVVTLdVSRdVTVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTdM0TRMIDVkJAAABANBac8ytl45B6KyXyCikoNdOOeak18wogpznEDFjmMdSMUMMxpZBhJQFQkNWBABRAACAMcgxxBxyzknqJEXOOSodpcY5R6mj1FFKsaZaO0qltlRr45yj1FHKKKVaS6sdpVRrqrEAAIAABwCAAAuh0JAVAUAUAACBDFIKKYWUYs4p55BSyjnmHGKKOaecY845KJ2UyjknnZMSKaWcY84p55yUzknmnJPSSSgAACDAAQAgwEIoNGRFABAnAOBwHE2TNE0UJU0TRU8UXdcTRdWVNM00NVFUVU0UTdVUVVkWTVWWJU0zTU0UVVMTRVUVVVOWTVW1Zc80bdlUVd0WVdW2ZVv2fVeWdd0zTdkWVdW2TVW1dVeWdV22bd2XNM00NVFUVU0UVddUVds2VdW2NVF0XVFVZVlUVVl2XVnXVVfWfU0UVdVTTdkVVVWWVdnVZVWWdV90Vd1WXdnXVVnWfdvWhV/WfcKoqrpuyq6uq7Ks+7Iu+7rt65RJ00xTE0VV1URRVU1XtW1TdW1bE0XXFVXVlkVTdWVVln1fdWXZ10TRdUVVlWVRVWVZlWVdd2VXt0VV1W1Vdn3fdF1dl3VdWGZb94XTdXVdlWXfV2VZ92Vdx9Z13/dM07ZN19V101V139Z15Zlt2/hFVdV1VZaFX5Vl39eF4Xlu3ReeUVV13ZRdX1dlWRduXzfavm48r21j2z6yryMMR76wLF3bNrq+TZh13egbQ+E3hjTTtG3TVXXddF1fl3XdaOu6UFRVXVdl2fdVV/Z9W/eF4fZ93xhV1/dVWRaG1ZadYfd9pe4LlVW2hd/WdeeYbV1YfuPo/L4ydHVbaOu6scy+rjy7cXSGPgIAAAYcAAACTCgDhYasCADiBAAYhJxDTEGIFIMQQkgphJBSxBiEzDkpGXNSQimphVJSixiDkDkmJXNOSiihpVBKS6GE1kIpsYVSWmyt1ZpaizWE0loopbVQSouppRpbazVGjEHInJOSOSellNJaKKW1zDkqnYOUOggppZRaLCnFWDknJYOOSgchpZJKTCWlGEMqsZWUYiwpxdhabLnFmHMopcWSSmwlpVhbTDm2GHOOGIOQOSclc05KKKW1UlJrlXNSOggpZQ5KKinFWEpKMXNOSgchpQ5CSiWlGFNKsYVSYisp1VhKarHFmHNLMdZQUoslpRhLSjG2GHNuseXWQWgtpBJjKCXGFmOurbUaQymxlZRiLCnVFmOtvcWYcyglxpJKjSWlWFuNucYYc06x5ZparLnF2GttufWac9CptVpTTLm2GHOOuQVZc+69g9BaKKXFUEqMrbVaW4w5h1JiKynVWEqKtcWYc2ux9lBKjCWlWEtKNbYYa4419ppaq7XFmGtqseaac+8x5thTazW3GGtOseVac+695tZjAQAAAw4AAAEmlIFCQ1YCAFEAAAQhSjEGoUGIMeekNAgx5pyUijHnIKRSMeYchFIy5yCUklLmHIRSUgqlpJJSa6GUUlJqrQAAgAIHAIAAGzQlFgcoNGQlAJAKAGBwHMvyPFE0Vdl2LMnzRNE0VdW2HcvyPFE0TVW1bcvzRNE0VdV1dd3yPFE0VVV1XV33RFE1VdV1ZVn3PVE0VVV1XVn2fdNUVdV1ZVm2hV80VVd1XVmWZd9YXdV1ZVm2dVsYVtV1XVmWbVs3hlvXdd33hWE5Ordu67rv+8LxO8cAAPAEBwCgAhtWRzgpGgssNGQlAJABAEAYg5BBSCGDEFJIIaUQUkoJAAAYcAAACDChDBQashIAiAIAAAiRUkopjZRSSimlkVJKKaWUEkIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIBQD4TzgA+D/YoCmxOEChISsBgHAAAMAYpZhyDDoJKTWMOQahlJRSaq1hjDEIpaTUWkuVcxBKSam12GKsnINQUkqtxRpjByGl1lqssdaaOwgppRZrrDnYHEppLcZYc86995BSazHWWnPvvZfWYqw159yDEMK0FGOuufbge+8ptlprzT34IIRQsdVac/BBCCGEizH33IPwPQghXIw55x6E8MEHYQAAd4MDAESCjTOsJJ0VjgYXGrISAAgJACAQYoox55yDEEIIkVKMOecchBBCKCVSijHnnIMOQgglZIw55xyEEEIopZSMMeecgxBCCaWUkjnnHIQQQiillFIy56CDEEIJpZRSSucchBBCCKWUUkrpoIMQQgmllFJKKSGEEEIJpZRSSiklhBBCCaWUUkoppYQQSiillFJKKaWUEEIppZRSSimllBJCKKWUUkoppZSSQimllFJKKaWUUlIopZRSSimllFJKCaWUUkoppZSUUkkFAAAcOAAABBhBJxlVFmGjCRcegEJDVgIAQAAAFMRWU4mdQcwxZ6khCDGoqUJKKYYxQ8ogpilTCiGFIXOKIQKhxVZLxQAAABAEAAgICQAwQFAwAwAMDhA+B0EnQHC0AQAIQmSGSDQsBIcHlQARMRUAJCYo5AJAhcVF2sUFdBnggi7uOhBCEIIQxOIACkjAwQk3PPGGJ9zgBJ2iUgcBAAAAAHAAAA8AAMcFEBHRHEaGxgZHh8cHSEgAAAAAAMgAwAcAwCECREQ0h5GhscHR4fEBEhIAAAAAAAAAAAAEBAQAAAAAAAIAAAAEBE9nZ1MABMCoAAAAAAAAlyRccAIAAAAgEfexaSst3iUjIzAqKSAfHB4XKirY0h4THi0p09odAQEqK8wlJiknKionHx0dHC0uxSwsKSwtLCIaAQEBLy6bLCwtLC8uJx4cHR4tMIwvLTAtMSwhNwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAVzV+g8W6L07dCSXTQAA5D8np315taYvSZHJ3Sa8d7k2H/t9lpv6TK5+485M28LHbD9ABW1aAAB7AWqs/oIpqA/tVOsy5HNTEMw09Fy5FEZy7D1pV+nDNAPy2DXhIgAs/10+pV21NFSGugIAQBQJ4ANALwAFgHcCOE8AcwKMexJAAzAZgDMD2BqABLQAARhVewIA6Bm2AQDYwwHytwWMMUaasaqq2vspwd3d3f2GqiqAOl1EAAhhKACInKIKgAQfqgB4SaIAAB0AVDV9VgQAX7wKoKr8dwcAaagCAAC0qQAAUAAANEPVLaY7AHjt0G7m+f89dq1j336qhw86Wr6H/3UAIJ8/zAAw8/cAAIz9ZgwJAFgCJhYAIJ83AIB8DgCAWqEBAD4DV+Dnxg4gA+SgYCwABXLtFwBcWZ0TCUQBpAAAHcDKn3KRklgUsrsNhbyMcWSTFbtDpBxi8A4AXNmEJwDh9WcCPAkA9OQEuRpGDit8uhxvbVib++j9pcbgEQxk2QIjAL0/MgEpAOAPRKmge2p/pcO1Lr1RHrkm6kmUFYO2EEzbzC8O+gAyaMMMAEAF0G4kVS09nlpmfc3JqH6a31qjczXan2lM50Ps3FpFr/O8A1TVokPF3k/DsuayoQEA2HSpvbZFhJ5aIkTc3rKKbW5CyfCSrvjKA5qzAdzEuwY9Dj8cAUwCAP++u3+e35fek1ft2rvS3s9e6iqhdFr47TF6encHpMiFpDgLf6gXIAQAUj8WDVWT3VdH+qdbsGFPLNVyiAWEyIeEStfHqDUQJADgzluvSSw2M09cqnf2d2nZkZozhMg3CbfhlAQQQADgHkd/42sfbXnZfD4SWFpGA4TI15ICaDhpExBAAGAv8/kqffzoN9yoysR39O0iAXzIhX1ku9QAQAAAAAj2759s1b6yLn8FTFcfuyZvXycoBGnEt7Q/9fj3cKz7vB1i117K1De6Sd3rHq/O32+0SyUCPF8ve7eXb5RcopNGBUAai/3rdPsU2zlo2klCZZ6J3vQkggdMnzVikzAb+ggG6CapTfb3e/MeR3cAkWRIXgEAAOApOQDXWwCALMAKAABcAA5dAQDuAeCeBgAJANoGAAUbgBJsQABsdAJgLwDARzBMu91ug32bHONxHMcRodYkxwgAEPlbEwAAj6StCQC2BABABQAAIMZ/NAEAAFIAAKjGHxUAADQLAADgCAAAQFAAAKAXAABQDgAA7h8AANATAACAyuQ3/O+7R4z+rZeMqsP3lZwBANX7G90cxwEAAIAvAQAAv2sAAIB/FAgAAGINAAAMAAAAjwaA7ggAAPgAAKcGFtgEVtjlsvdvDzMeVdJcVyJDKgDAAehJALABNuC+TmCM5gC2AcAAtGAGYEYnABrLAhVxaG07EvYVFw3lqHRvTUW9QAEG3ZuGctHQZ+wtFAAASHfTUgcAvDRUAYAXcs4IAACUbuleAMBga2m3vpV/OTefu7cr+ctHep7D+P3je6OZ+213vNkyALOv05ZzwGWyv3kJAIBJ/T4EAAD4FhgAAHTbAAAAUGMAAEDrZ8wAAP4rAID/L+UccMsIAP9GVgIAwLQA4IMLgKFD4E8DwP8A8AHoDgEAhMgnV2G+sCKiQQAEAPrtf5dqZTkPCZLDovbyjpoEhMhFqhVAwWJFAAAAAAAAnN4BAITI164SouF0B0AAAACw3/L/vfe/f/9qmzRp0qRJAjRXj3r+dnJ6pMAJ0vGFsRyJ3Nrb+KzbD4T1RDvRyIjLQ5kHNT7GzRGcMSIVABRh7/2vrvK+kl6pEKAJoB6emrmRsmLvvGum6zIaC4ZRSJx3EgZUADMb+vhVwE2y3/03FHdrld/7eynUe3qkffXdGyfzPM9fUxIkwE8AAB8DAHiUAEBXAADvBQC8AgDuSQDgAQC2LQFA9QgAQALARgDA2HAAgABG/Nuqxib39Hjot67HcRzHesSowDxLADzGGAHt0gQAAFqrEBUAAHzvc7QmAADE3lsDAAAIhwUAAKA+UQAAgHZdAQAAyj0CAADg2wgAAACxAwAAgHgEAADA4y4AAGCeAAAAwKkBAACAwQHgaAsAAAB+HBMAAAAyAgAAAHwAAAAGDSAQAE4NAHbItZWXFO7WPqORUvmBbZFwn+f2VD94f3XmjqMj6z+qZCzZAE8AwH0AAO8EAMYMANwkAOA2AHCdAMAMAIyZGQCMFjMATNAJgKoNRog3jzB3+v360vOsY28zvhtN99JlgkqfTQWg/DDdm4buoqFUOu4AAFDe/F+aCgDgpWuiAABoqJh4qgIAAHKOQ7oDAADp2l3UCwAoraQAAAAKmxQAAKiXFQAAgG/bVQYAAOBbAQAAIO0DsFNN/5cCAIDJ88sCAABgb+oGAABnDUCen+0EAMCPAkgLAEgLAG4AjMjXkIICDbdOgAACAMG65BbbPo50YZ5bF/rn9gAAABTTsfrJu2kcx4HaAqBtLKku/4l40df/P/AuS6Ggnf/P2mV2d6ctu3pSAATh1UZk/N2tDyl0oanJApCtK5b5yxWe1pafpkkpTMg3lpMQcosQ1exMQBXS2KX18Aeu6/348Ts+vGd4OE4DyLKsLMsyAQAWAFwvizcAAOTrAJgA6H7/3q57AgAAORkA0gCg4NQJAAABIMWMBYAJACAGEVTEGH1ZjhhyYjEWsgwAAoC7z6vzVsXRAAAAUFXNa9pGEwAAcPd5QZm3Hy4CAAAAqjp6NCIAAABA3SWIhIwqAAAAgEipAgA0BQAAAAAAqNN1dfUa1JOJjpZSqVAohBhzuHFTsVjluoEHAABgmgVg8UAdAOBPAwAAAABlAwDAjCEAAACALwDUXmspV+DO/pFo0BQPANwkf0TqoxSl4nzETUTZjYxg6A8Cd/UI5N7VG1cBdKc+T3TCkhrA/IfIoB5BueUt/kLLI9DHFdzAfMAdEAXk3tWLo0C9kzeFpNQ0GQDQl3hgmE0vLO5t/oa8kEJ9lOgRzMcYajA0AOTe1Ruzqug5/hSQsJQGAN4wPwk3qwta1eAK+QeaIMolPgz0EPMXARzfxy1C3CaiSGytQQJwzrT3sxzHsBjeLBPwi2+iR4n1xJmYdPMODRxQAARN//pBb1PGGMlSCgDE6JrQ1v97691dK48by2u15RcxXP+tw7IJq2euAsRIN5ee9o/U1gjWAMBI/395Wasq7LgzLl8KWaIQV6B0/5o55J7mE5TIGWU6C3/1AggBgLTWf1XSxDc6O+VzPC+hssxeqwKEyHtu1V1YzyKBEAAAmw2NwLQJW8Y2vX+xzoP9AITI04OqNqxoAQggAJB6s7s3fUvWXrKN7rHn7AsAfMg3iawNiwYQQABA7/l9o7Gc/HyI5eTng2UVABzPEqcG4/b2CQ3UIOno3yrnf3///UF73a/RJONv9LkVOnS+p0KHGH4/3lEUABTh+xWKyvzdnnSDZC4JR8EiERSAtnKauEZ9F+VArgiLxU+wijQH+7Kt3l8lgwbyKG4P53uYq1upOXv7Bcr6FsTgPoDujpjn3d1d4AgqAOYyARQCAJDgNABwAKCv//suAJgAwA5IA9gGpAEFwAR9AOCdAAAAWEAG4AgAAeD7OHI+jr9GPKMdaDyO/++99y8xAiAiImWMtdYC5wmgmqUbEQAAAADAfd46+ry3qgoAAACAqk1wAKi6dUx3BwBABADcPaxVAABIUwUAAAAAACgNAACoGisCIpHoLFY5QF1VBOiTTCEUimTPZbo5jgMAmAUAOEFPAOTe2corhvD610d8H8lNQThKFoFAAXhnqp1K8C+DA6oEBYFoQbCBcAFiIZEA5OCzHQdRzIMYgCNgNmkCABoXgBFIYWblKft+nTJmCcb9C24x4A6Iws6/sALk3ln1FEM4/3r2AwRfaGcTSBY8gP+SLg2gaPABUbFCOUwDgu24lGVhJeTgqeWw+GI/BuC+ZM0mCyuAKIDKAzZUAgv49Wr10iZbmxPwFwi47ReIQKIB9OBXdxx02e/0yEkkdUmbBQrAl4cJIQRcR69L3UVYlP1teA/hNUys6Gb/DikF/M4p9dWg/u5P5hnSAHrX/bU2ev7+LU3uvX97+3Sn+kV1IVe3uMqW1S3E8AGEyAVwqqI96pojCYAAgPs15/rZZ9POf11+r+Kh84TxdTcAfMi5fLcaAgAAwHzbvnmyTk9YSn5PmM0nNgEAAAAUSw9zNXiT3TFRR9eYApjjeXx/2yfiZJnvD44e3f3fBok/Lr07/vY/23NnK3cQAPzeqbwz4E/3aZNpAws1kEtAAXhlsUe10ZJqrX1xKJwGdKm+stlc7/13QH6ATADyGCaeVW/Xr+bWrjygzxj5eipjAswAJgCwlZDIvNsqEQEAMoC9A4Ak6boEAEhBCpCCFACViEhISLWq934LAICqCktUa/QTo9YYEQEAqKr3/unu+LCqCgAA5OH4uFHtmd4KYl/98vO3k03R+9v57q7VCoLg+hoYGRkBYI6MAEBcOAAozRkAAAAAZv5ppoDrjwIBAAAAAMQEeKcAAOxgf8+DaApvxhnhSkwkXgmWaMxCAADe0mebEX4DIVZTKIAqQBXyDvgJ8wgk7GB/bwV5Cm/mT52uwE3gToeESjQKwLI1z0Xgz9BfAAooFDBAJAqcKshvAAnkYH/4QTSFZ+NEOiqCL5juAFtCMA0LAPDP1tosdQuSpnAnwKIwLeAOJABNwADk4KG3gjyFV/Nnts+M80SlIfBMBhqA8z/mPQpMAvYQAACMBZTXQI0BQAyAAOTgKZyDUIa4+kibGIEqDotnAoJ5YAH43Yv03/rNuDEWnwcUv0BXoWYBvSAfAFkD/NKzjjPgfM/0AAeY5wAQpPzb4ziOrHiM+tR/qTda87mlenjz5HaWlpeXl7tlAKxI52XO60+3zZICAHj+zjBljNOfs9fvNT611VarmZda2PMet4bWDoTIgb+x8FPbACEAcM5vld9733I532Tg7NmpJa/ABIzKl23Vu6YECCAAIDGcMiMTlvQ637NfOq2vJQGMyPcJBdqO6JFAAAGAJ39btT4tKva1M5uPM5tPLITI15ICbXjfsYAAAgBH6sc23T8j/VmOV1bHK6u+BfzG7pzM22+/FRypEqTxppxhLGmr+N//u+qr2Ot+ObdHpTDfH1gAmYvqvf1XAeRc1/7/2lVrnsPegMVxvQLAXoIGDQDt5/+TJ7TWxOLxSA88xpgNtCZbAQYA8jVxD9IIHvb19K7/xNP/N19aTdyVskK/SgCAkQbzd9PMBEAGyONuA4AJADgCSJKO6gkAQIYOAADSACUACGHU13tVVVVVUa2NI15PrFVVVVVVm6Zj9yUJAgAA0PtIzB9CjAAAAHi0JQIAAICqLSMAhBdVVwMAmKOf8p94wT26yXXaOrk+011EIlED1AEAIPQU5NxF+VdsoF4MAEpiAAs6CAsAgS4AIwoKqFsADkAEGkokzKMPWFjtUSXwF4DvsgDs3AX7OVaAiRgAriTC+2+4EgRYAAhUAHyqwO0FlAJYBagAaOlVyDKPpcbIqwfs3AX7UWxg+jEAvCMG0GCXoAEI1AAvB3QCHIB5KMAvoWQ6VZR1DHDDvzUAwN9YsADs3AW/U2yifAwAHRx7FwBsEDYAEOgAEAH4VgGwBgCACdixivudo66xbwDwFw/k3osLB3Ew35Y14wdAwfH+a8EDXAWowVYAYBp+cyZpAaQIxTibQy0F8BIDkCOAZ8ECxNC/UZm373tsGJqb24kC8PNz/vM72rxvV6N19u8IKuH9/zstslYE8+3tFh6EyJeQ0Z4Uh8YQADjIiflnrh0T6rmGMGfr8ti1wFsTswkalvz3qG+6AA4gCQQAAAAAAAAAbXl5ORk+EmBeXjZ5Pj4+BEvLyya8C5iXk+Hj4yOBtry8DF8DDg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4O',
            snd_equip_mobile: 'data:audio/ogg;base64,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',
            snd_hurt_mobile: 'data:audio/ogg;base64,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',
            snd_menu_confirm_mobile: 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAAAAAAAAAAAAAAUKoZYBHgF2b3JiaXMAAAAAAUSsAAAAAAAAcBEBAAAAAAC4AU9nZ1MAAAAAAAAAAAAAAAAAAAEAAABt/mPSDjD///////////////8RA3ZvcmJpcwYAAABmZm1wZWcBAAAAFgAAAGVuY29kZXI9TGF2YyBsaWJ2b3JiaXMBBXZvcmJpcyJCQ1YBAEAAACRzGCpGpXMWhBAaQlAZ4xxCzmvsGUJMEYIcMkxbyyVzkCGkoEKIWyiB0JBVAABAAACHQXgUhIpBCCGEJT1YkoMnPQghhIg5eBSEaUEIIYQQQgghhBBCCCGERTlokoMnQQgdhOMwOAyD5Tj4HIRFOVgQgydB6CCED0K4moOsOQghhCQ1SFCDBjnoHITCLCiKgsQwuBaEBDUojILkMMjUgwtCiJqDSTX4GoRnQXgWhGlBCCGEJEFIkIMGQcgYhEZBWJKDBjm4FITLQagahCo5CB+EIDRkFQCQAACgoiiKoigKEBqyCgDIAAAQQFEUx3EcyZEcybEcCwgNWQUAAAEACAAAoEiKpEiO5EiSJFmSJVmSJVmS5omqLMuyLMuyLMsyEBqyCgBIAABQUQxFcRQHCA1ZBQBkAAAIoDiKpViKpWiK54iOCISGrAIAgAAABAAAEDRDUzxHlETPVFXXtm3btm3btm3btm3btm1blmUZCA1ZBQBAAAAQ0mlmqQaIMAMZBkJDVgEACAAAgBGKMMSA0JBVAABAAACAGEoOogmtOd+c46BZDppKsTkdnEi1eZKbirk555xzzsnmnDHOOeecopxZDJoJrTnnnMSgWQqaCa0555wnsXnQmiqtOeeccc7pYJwRxjnnnCateZCajbU555wFrWmOmkuxOeecSLl5UptLtTnnnHPOOeecc84555zqxekcnBPOOeecqL25lpvQxTnnnE/G6d6cEM4555xzzjnnnHPOOeecIDRkFQAABABAEIaNYdwpCNLnaCBGEWIaMulB9+gwCRqDnELq0ehopJQ6CCWVcVJKJwgNWQUAAAIAQAghhRRSSCGFFFJIIYUUYoghhhhyyimnoIJKKqmooowyyyyzzDLLLLPMOuyssw47DDHEEEMrrcRSU2011lhr7jnnmoO0VlprrbVSSimllFIKQkNWAQAgAAAEQgYZZJBRSCGFFGKIKaeccgoqqIDQkFUAACAAgAAAAABP8hzRER3RER3RER3RER3R8RzPESVREiVREi3TMjXTU0VVdWXXlnVZt31b2IVd933d933d+HVhWJZlWZZlWZZlWZZlWZZlWZYgNGQVAAACAAAghBBCSCGFFFJIKcYYc8w56CSUEAgNWQUAAAIACAAAAHAUR3EcyZEcSbIkS9IkzdIsT/M0TxM9URRF0zRV0RVdUTdtUTZl0zVdUzZdVVZtV5ZtW7Z125dl2/d93/d93/d93/d93/d9XQdCQ1YBABIAADqSIymSIimS4ziOJElAaMgqAEAGAEAAAIriKI7jOJIkSZIlaZJneZaomZrpmZ4qqkBoyCoAABAAQAAAAAAAAIqmeIqpeIqoeI7oiJJomZaoqZoryqbsuq7ruq7ruq7ruq7ruq7ruq7ruq7ruq7ruq7ruq7ruq7ruq4LhIasAgAkAAB0JEdyJEdSJEVSJEdygNCQVQCADACAAAAcwzEkRXIsy9I0T/M0TxM90RM901NFV3SB0JBVAAAgAIAAAAAAAAAMybAUy9EcTRIl1VItVVMt1VJF1VNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVN0zRNEwgNWQkAAAEAwByEzi2okEkJLZiKKMQk6FJBBynozjCCoPcSOYOcxxQ5QpDGlkmEmAZCQ1YEAFEAAIAxyDHEHHLOUeokRc45Kh2lxjlHqaPUUUqxphgzSiW2VGvjnKPUUeoopRpLix2lFGOKsQAAgAAHAIAAC6HQkBUBQBQAAIEQUgophZRizinnkFLKMeYcUoo5p5xTzjkonZTKOSadkxIppZxjzinnnJTOSeWck9JJKAAAIMABACDAQig0ZEUAECcA4HAczZM0TRQlTRNFTxRd1RNF1ZU0zTQ1UVRVTRRN1VRVWRZN1ZUlTTNNTRRVUxNFVRVVU5ZNVZVlzzRt2VRV3RZVVbdlW/ZtV5Z13zNN2RZV1dZNVbV1V5Z13ZVt3Zc0zTQ1UVRVTRRV11RVWzZV1bY1UXRdUVVlWVRVWXZl17ZVV9Z1TRRd11NN2RVVVZZV2dVlVZZ1X3RVXVdd19dVV/Z92dZ9XdZ1YRhV1dZN19V1VXZ1X9Zt35d1XVgmTTNNTRRdVRNFVTVV1bZNVZVtTRRdV1RVWRZN1ZVV2fV11XVtXRNF1xVVVZZFVZVdVXZ135Vl3RZVVbdV2fV1U3V1XbZtY5htWxdOVbV1VXZ1YZVd3Zd12xhuXfeNzTRt23RdXTddV9dtXTeGWdd9X1RVX1dl2TdWWfZ93fexdd8YRlXVdVN2hV91ZV+4dV9Zbl3nvLaNbPvKMeu+M/xGdF84ltW2Ka9uC8Os6/jC7iy78Cs907R101V13VRdX5dtWxluXUdUVV9XZVn4TVf2hVvXjePWfWcZXZeuyrIvrLKsDLfvG8Pu+8Ky2rZxzLaOa+vKsftKZfeVZXht21dmXSfMum0cu68zfmFIAADAgAMAQIAJZaDQkBUBQJwAAIOQc4gpCJFiEEIIKYUQUooYg5A5JyVjTkopJbVQSmoRYxAqx6RkzkkJpbQUSmkplNJaKSW2UEqLrbVaU2uxhlJaC6W0WEppMbVWY2utxogxCZlzUjLnpJRSWiultJY5R6VzkFIHIaWSUoslpRgr56Rk0FHpIKRUUomppBRjKCXGklKMJaUaW4ottxhzDqW0WFKJsaQUY4spxxZjzhFjUDLnpGTOSSmltFZKaq1yTkoHIaXMQUklpRhLSSlmzknqIKTUQUeppBRjSSm2UEpsJaUaS0kxthhzbim2GkppsaQUa0kpxhZjzi223DoIrYVUYgylxNhizLm1VmsoJcaSUqwlpdpirLW3GHMNpcRYUqmxpBRrq7HXGGPNKbZcU4s1txh7ri23XnMOPrVWc4op1xZj7jG3IGvOvXcQWgulxBhKibHFVmuLMedQSowlpRpLSbG2GHNtrdYeSomxpBRrSanGGGPOscZeU2u1thh7Ti3WXHPuvcYcg2qt5hZj7im2nGuuvdfcgiwAAGDAAQAgwIQyUGjISgAgCgAAMIYx5yA0CjnnnJQGKeeck5I5ByGElDLnIISQUucchJJa65yDUEprpZSUWouxlJJSazEWAABQ4AAAEGCDpsTiAIWGrAQAUgEADI5jWZ5nmqpqy44leZ4oqqar6rYjWZ4niqqqqrZteZ4pqqqquq6uW54niqqquq6r655pqqqquq4s675nmqqqqq4ry75vqqrruq4sy7Lwm6rquq4ry7LtC6vryrIs27ZuG8PqurIsy7Zt68px67qu+76xHEe2rvu6MPzGcCQAADzBAQCowIbVEU6KxgILDVkJAGQAABDGIGQQUsgghBRSSCmElFICAAAGHAAAAkwoA4WGrAQAogAAACKstdZaY6211lqLrLXWWmutpZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSAQBSEw4AUg82aEosDlBoyEoAIBUAADCGKaYcgww6w5Rz0EkoJaWGMeecg5JSSpVzUkpJqbXWMueklJJSazFmEFJpLcYaa80glJRajDH2GkppLcZac889lNJai7XW3HNpLcYce89BCJNSq7XmHIQOqrVaa845+CBMa7HWGnQQQhgAgNPgAAB6YMPqCCdFY4GFhqwEAFIBAAiElGLMMeecQ0ox5pxzzjmHlGLMMeecc04xxpxzzkEIoWLMMecghBBC5pxzzkEIIYTMOeecgxBCCJ1zDkIIIYQQOucghBBCCCF0DkIIIYQQQugghBBCCCGE0EEIIYQQQgihgxBCCCGEEEIBAIAFDgAAATasjnBSNBZYaMhKAAAIAACC2nIsMTNIOeYsNgQhBblVSCnFtGZGGeW4VQohpDRkTjFkpMRac6kcAAAAggAAASEBAAYICmYAgMEBwucg6AQIjjYAAEGIzBCJhoXg8KASICKmAoDEBIVcAKiwuEi7uIAuA1zQxV0HQghCEIJYHEABCTg44YYn3vCEG5ygU1TqIAAAAAAADADgAQDguAAiIprDyNDY4Ojw+AAJCQAAAAAAGAD4AAA4RICIiOYwMjQ2ODo8PkBCAgAAAAAAAAAAgICAAAAAAABAAAAAgIBPZ2dTAAQ+IAAAAAAAAAAAAAACAAAAxu6XjjsuMy8uMDIvLi80LS0sKywsLiwtMDUwLjEvMTIzNC0tKCkpKSksMi8vLC0tLC8vMDElJicoJykqLC6TpTTTGMD55rXqc+gNQB0HzO/3AnieamLPoqKi1jqioYd20qx0KK02I6vtvXzcM738VnCBc4SbvUYJAACoDlC9VRPgE04wAfBVEVC1WhDAY4DaWYnz1W2DMQCxx0HAb7xTIADcVDYI5wThBVM9APCIrID7e4DqLQEycAIBAGaNAMA5CgqouxUiwApwsTxlV01PCdxWtgDnxPCMsVYNkbaKADxKVMB+I0D1MwAWUuOlaVcA7EsAgN9EQKHuAwqo0wDcVJCCc9LwgoMeAPjjBFQHqH5qgIVisAEAIl8BUHUBB2pYILPT3ciltQ7gbJQCFgDcVKYI58TwiqpRAgBUwP13gOotAOpEMdgE+AEA6EkHB6pWgQL4AaZ6uprebm0TwNrjJ9xU0IFzgvCCgR4A+F+nAvYbANVWAXBDERIA+rcBgD9GQIByAwL4BTisoxvPZBoI3FTQgnOEF4x6AGDKE1AdoFIVgBGogQQAY2MRgFsDCjAAHlf622fWQwDOqhQIANxUQoZzgvCCVQ8APEpUQH8PUHUFwAZqMHAAawIAsG2HApglUACpBf6Oi/r5yEAA9FQpiGIxGOgBEjzRegio+gA8QSEYfF0hSPq5gId1naF3HDwccw2+/qO3/ertmk1VHMfxP9xSV5o8fQM4/QP1TwDSM0WwiP3r1NPrCkCMJtaT9oK5ObG6WSUrT9bl7smEd9zURTk/kFqjAmiMhvobAOHXFAPasN82SCcAAPl+zlGD3lbhyBUb+vof2wHgR9zSxTCJRcxrVACNRoX6LQA8UxPQx3y3xV8AAFgfxcPqbTMezoOdpHWcBXAM3NLFcIlFyWtUAI1GQ/0SAG5qAjrsHzhwBwDA1OLcNyjE5sLGhl4fzR0A19zUxdB9gCmNCqDRqFC/BYAfagL6mO948RUAANYp7tdsm/GoPNjprOHzAE4F3NLFcIlFyWpUAI1GQ/0SAG5qAjrsH2yQOgAAUt25b1CKzYUtG3pr/rgjAffc0sUwiUXMalQAjUaF+k0AeKkJ6KP1F1rkDgCAelL8rt5pxqN6g53tOfdWAE4A3NLFcIlFaTUqgEajoX4VAK6pCeiw/33hBgAApJ7z28CMzYXTlsI2+0YC7gEM027yZSqPqA7i+zQGqN8HgG8y8k7C4R3/NHgVAADycgsYfSd+M/YucVwRvgAUTahs4qb/e/c2qdIPE70ziDMNV5c1UvcTie/UA8Af9UdG/j3/Zk1kZOT25/+/fEjc1AUZYSlfr1ECAABAB9BiH6QpBoI/B97iUQcQKp6CxqUXXnr6WQ8B22UAJ7M6NfUB8PsBANzSRbnE5n/VA1wU8HcBqBAA0PQLNQH8BeBnPioAlfQu7Hlomz0NAK9/rjKtBV5GANzSBR/H5g16gH9/AVVPQIUAWpiAmmDhKyAXjwpAFwp+ebh3gAB8V8z0agWgSwHc1AXvxFL+U6MEAACADqCFAs4EcIFOfCoAbZWgvLO22dVi310EpJcnTo68GKOVAKUA3NIFb8cSvEEPcKmA/wKoEEALz3AmkDAAxp+fEsCcOHyoUKSnIQCf/hU2qCZgSwHc0kWZxBL8Tj3AX2b4vwBUCABodsDZAvg2wN0+JYC5aBc+joT8VCUA3+5oRQ3AtxEA3NIFb8fmmxolAAAAdAAtVMDZgsEFDuKTAMLPg49Vyf5EYK9sAeS+NJw8nNqWtIDPAQDc1AVtx+bX6wGqWgVUJQEVAmjRl4WzBXACSGIPvxLAH1iUjxUpe1YXCXza+OWjFIB/KgDcVNfU20gP8G3CoFHQNQBosb/WnA1wflBT08BtZ+jikwCuLOVsOp0pNh1JYmerlNCcn0wALNFukmhffzlrhE6gIsG3NQA0nqDte9OQu3dPKl1MV+8AwWPrHqB7wjbdh8kLBMmWSITeAEZULdQSAKY5DySttFtKciPSgCaUjfr/Wqei7vyOKurRhEaf6GIT1MYFG8cipoD646cRVafRGGoFAAzSmi32DPm8gFUAACInEEoXsiWgA8zGBTvHIqYaFUCjEaiVABCcCThG3DkxBACA4sFxd+RE1T+AnTWoIQATzMYFO8ciphoVQKMx1AoASE4CmpEvAIcCAOBE2OzlETnd/kM8+LiHBHTExgUfxyJWjQqg0QjUSwAQnAQcI+4aVgEAoGiwtWbkRNU/gF34proATLzGRTnHolSNCqDRGGo1ACRnAlrI1xUYCgCAo3DVxyNyuj2CsHlokQR0tMgFk4v8azSARiNQLwFAwRlwinidcDYAAK4E5VxrTBzG94jYMcGhj+MF4AzkSAvFVugApy8CNRJAS2oGkPCWGLjzQ8GD0G/QxHvc6Tpx1yuTx2mqLvUU//+vL47lAcxIRwxsxq+PeDgIvk14GBq8VQItTEB6r54lmLRaY8nLt2YocT1tOIVylP2NozYWtMgFS8A5AlGjBAAA9PmpEmghoCaACzwkkigANCMNDhh5NF8V7KgNQDjYAt5TBgC0yAVLYAn+UQ9wqYB/CFAufiqBFhZqggUNkH0sdysAzF8dbujNyYoKOOsyALTGRRnBOQKFHuDbhF8Orf6zEmhhQE0A7QG61AuLAsA1GuGXjybM6AmAT5cSALTIBU/AOQJVD/CPAy6TgD5/lkALBdQEcD9ARI0cCgAhU/CvumIH9VjgvdcJALTIBXNhCf6GHqCygK8GoFz8ZwJoIaFWMHgA7MO5CgDxl4L/1aP+rgo4+30BtMgFd2HzjxolAIBW/2cCaLENtQJ4gIfxPnUAJhLgb81k/lwhXFkIhO3TgE+vpwC0yAVPYUn+gR7g1wP+YQJ6+v8dQAsHagUQHiC+/stDAAgNh4d+erPMEAu8dykLALxIxyZsPlQPUBZwERryPw20UEJNADEDvvq/nCgEiGkmIX+tife8BZHnzb33jZf1AqxIN9bboX7zrrG+BVT6T9j/1KAugH3AzHipNBKOvzNne6VnfoJu/wXFbQEALKcnXQH8yAWF5mF/ZGIPHDeAft9yjDqc2Auo6uqBTubd5yc6+QHYOWsBtMgFv8QiZAH1Px+jfkyjUeHPgL6Nn+co5l9gCgCIdoY/ASzWbwK0yAX/hHPJalQAjUbDb0AxoMP+FxgHgK6dNjbnZyzF1cNPAB7t4wC0xgW/hHOJ1agAGo0KfwHFgD7mDxdaAPC7ZtIMw0PB1qcSzwEs1v8BtMgF/4RzyWpUAI1Gw29AIaDD/hfgAPDLz8bm/IyluO7+MwCP9lcArMhF+cYithoVQKNR4T+AYkAf888ulgKAvzXbZigfCtS333wO4BjrfwCsSChZQWMRW40KoNFoqJ8A0BRAh/1vBr8DAOAI3DPMY3N+ylLcMPobgGvcSFMzc3zKz0z92PDHUP+yAHhZjunrfzu1/KeHMI+uAE7/1Rbg6qPyEQwPANxIC/UlqI+OYZFgVumRyE2gAQs33DuXrF8SS+I2yCmLNvdrG+BaoeeYaeGEFAFaB9Wv8Ht2rRQi7K8//LN9ef/54nQ3iIiIiAB7YAG0AlVJABDDUwIAkeABAO8AAIDIFQAAQAxAnQA9v+/2bq3NOVnXdamqqjoTAREJQURkWKMAAFDtd1UFABBRAICq62HHCAAAcHOMAAAAAAAiaap9+9XlMkYe35+fn/f39/ePhtEw0p4rEolEQK8xAQBA/JMCThJeB/Uv9q0v0YfNLX5c2D6+cwHEq1qBMRIAYowBAAr0AQBPj6cBANAAiAH09USCOoV6YclLjAoAcUvvXwMAIB5ZAQDkbbejNQAAAACIMU2XBaGvb37s5s2bN2/e/PCxj33sYx/72Mc+9rGPfexjH/vYzZs3b9aMUU32c6yurq6urv6Tc1pdRVADAHbOeff5yZwBAIC+urr6T6sPNWMkANUkQKX6JQ4=',
            snd_mercyadd_mobile: 'data:audio/ogg;base64,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',
            snd_noise_mobile: 'data:audio/ogg;base64,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',
            snd_spearappear_mobile: 'data:audio/ogg;base64,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UTRNmKZpqiowTVUVAABQ4AAAEGCDpsTiAIWGrAQAQgIAHIpiWZrmeZ4niqapmiRJ0zxPFEXRNE1TVUmSpnmeKIqiaZqmqrIsTfM8URRF01RVVYWmeZ4oiqJpqqrqwvM8TxRF0TRV1XXheZ4niqJomqrquhBFUTRN01RNVXVdIIqmaZqqqqquC0RPFE1TVV3XdYHniaJpqqqrui4QTdNUVVV1XVkGmKZpqqrryjJAVVXVdV1XlgGqqqqu67qyDFBV13VdWZZlAK7rurIsywIAAA4cAAACjKCTjCqLsNGECw9AoSErAoAoAADAGKYUU8owJiGkEBrGJIQUQiYlpdJSqiCkUlIpFYRUSiolo5RSailVEFIpqZQKQiollVIAANiBAwDYgYVQaMhKACAPAIAwRinGGHNOIqQUY845JxFSijHnnJNKMeacc85JKRlzzDnnpJTOOeecc1JK5pxzzjkppXPOOeeclFJK55xzTkopJYTOQSellNI555wTAABU4AAAEGCjyOYEI0GFhqwEAFIBAAyOY1ma5nmiaJqWJGma53meKJqmJkma5nmeJ4qqyfM8TxRF0TRVled5niiKommqKtcVRdM0TVVVXbIsiqZpmqrqujBN01RV13VdmKZpqqrrui5sW1VV1XVlGbatqqrqurIMXNd1ZdmWgSy7ruzasgAA8AQHAKACG1ZHOCkaCyw0ZCUAkAEAQBiDkEIIIWUQQgohhJRSCAkAABhwAAAIMKEMFBqyEgBIBQAAjLHWWmuttdZAZ6211lprrYDMWmuttdZaa6211lprrbXWUmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaay2llFJKKaWUUkoppZRSSimllFJKBQD6VTgA+D/YsDrCSdFYYKEhKwGAcAAAwBilGHMMQimlVAgx5px0VFqLsUKIMeckpNRabMVzzkEoIZXWYiyecw5CKSnFVmNRKYRSUkottliLSqGjklJKrdVYjDGppNZai63GYoxJKbTUWosxFiNsTam12GqrsRhjayottBhjjMUIX2RsLabaag3GCCNbLC3VWmswxhjdW4ultpqLMT742lIsMdZcAAB3gwMARIKNM6wknRWOBhcashIACAkAIBBSijHGGHPOOeekUow55pxzDkIIoVSKMcaccw5CCCGUjDHm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'
        };
        const promises = Object.keys(files).map(key => {
            const url = files[key];
            return xhrArrayBuffer(url)
                .then(buf => {
                    return new Promise((resolve, reject) => {
                        const p = audioCtx.decodeAudioData(buf, resolve, reject);
                        if (p) p.then(resolve).catch(reject);
                    });
                })
                .then(decoded => { audioBuffers[key] = decoded; })
                .catch(e => console.warn('MK Audio load error:', key, e));
        });
        return Promise.all(promises);
    }

    const GAME_W = 640;
    const GAME_H = 480;

    const ctx = mkCanvas.getContext('2d', { alpha: true });

    mkCanvas.width = GAME_W;
    mkCanvas.height = GAME_H;

    const GW = GAME_W;
    const GH = GAME_H;

    // Cores em decimal BGR (valores exatos das constantes do GMS2)
    // c_aqua   = 16776960  ($FFFF00) → RGB(0,   255, 255)
    // c_orange = 4235519   ($40A0FF) → RGB(255, 160, 64)  — laranja padrão GMS2
    // c_green  = 32768     ($008000) → RGB(0,   128, 0)
    // c_white  = 16777215  ($FFFFFF) → RGB(255, 255, 255)
    const C_AQUA   = 16776960;
    const C_ORANGE = 4235519;
    const C_GREEN  = 32768;
    const C_WHITE  = 16777215;

    const BTN_ALPHA = 0.5;
    const SPRITE_A = 0.41;

    const SPRITES = { "spr_button_scale": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAJCAYAAABzNXH3AAAAtElEQVRIx9VVQQ7AIAgT4/+/zE4a0iBWXOLW0xwWKzQiqqoFICJSSHS+x4lip0Ddp2dk8lW7uRO8gn4Jtilvaba5WDRWJK5RLBvzLhoVIOOoyEVZx3q8yhA9YKfsOooxrtl1FJs/69gZr+GGnW7cQnf3rua37zWKZyuqqvqHAvbvSDP+O3kbkduyiW5iZ4p7b3F2yOB5vyzebYwmrCYcMwGjt8eLrabtbD3Lu9LM3GfmwkjzAwi82EfmQnnQAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAMCAYAAAAj+OBEAAAA50lEQVRIx9WW3RICIQiFpen9X5luYobOCIKCs52bChF3v/hxjCIxM0dsO/Zdv13/qF4dQUVERFFQ8pu/6nyuKr07glpgBCYREdr12r/Ao2pQCEj7oW22H2NZZ1prFf7X4HkPaNk0HMxEKztDL6POmsXtBHkML2LTdr3OoOxZno/VRk5VOjBmTX8FRPc9+fQyI9IXb2XXMTwNRgNAEFiGWEo3p+3jhpJXGtG1bLlGW0WmpWTUclUZ4/ff9aamB3Cn9KJ7HjU0spm3AreKH9mT8dlRCX28BMt39LGuJNbLRbIXz7egdWTaBwgWh1nQxeTgAAAAAElFTkSuQmCC"], "spr_joystick": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAApCAYAAACoYAD2AAABRElEQVRYw+2ZQRLDIAhFidNDehVP4FVyy3ZFxhpBiBBjp39Xo/jm04iaDQaVUnr3+uSct5E5Lg2WgFkCqwZI4PZ9hxijKezLCk4rjCmB7XaQukfJwlX2IQdYgnEg0n4cKPmAAsRJJQ5px1KgzUYO8AqcJk4L9NTQAhxxjwOlYtagXz8oQEs4afwSNLjNbqiDdoaLvXnQzaAd6KEYI7vWBgCfimIh5Go6eaeLKM7NJV6c8NRUo1JK75OTM1KNolK+RrpnA0h0bHq5depu1XX9gMSGJ8DW78QS6V4TsldHPUUtf2H04O6tnPO2ZroB5qScq3QBYPyuxkvdTe+dbvb2C/+DmJXWO3dzoBj4ETcYElDKgRH3KEAWkgMtJ+wBu96qSUBbILXc7yc1oCWw5q8gKSSi62gMZHmy1FS53/v6cBV4dG/wAamN40idLgN6AAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAApCAYAAACoYAD2AAAAg0lEQVRYw+3VWwrEIBBE0cqQBbkNV1zb6B1lvgIhDCTQrThwz5coNoVPCQAAAIvaqgq11o57X0SU1N+rAvbeJUm2dbYlHRVB0wWuAX+xnV7R1OSngFVBP5mQs6RD2k6NTwn5tN1vjsPwkDP8xe1Or2REbNdzd28v8U6eRv44AAAAWNYX/1E3PzQXGwkAAAAASUVORK5CYII="], "spr_button_left": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA6UlEQVRIx8WWyxGFIAxFgbGn7OmKCuyKPVXpCgaj+QDhvbtCPjlcYGK8UyqldFFj53l6TQxxEgcZhZKDIxAt9NUJAFeMcZbTlHN2pZRH/MeHFYgCtoY16AsYzKMz8jtdYXcHAKheXc65tWc2BgBX0CzuQTOq8cU7w6CV42ZhliDnnDu0IKrvS9Smfvr0SWcxRvNjZJ3h4KuvMkhBLIB1jerOrLKL7zPIrkRc9Z9EvMNd76qU4gM3wQr0cIbdrTrEoPrzFNPVCFQ6lVcNQk3koBzkswbRAEfFVldWUAwRYbNACiTCtGAO0OsGx1l/zk0T3/4AAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA9ElEQVRIx92WMRqDIAyFH349RV08GZ5Dhw4O9RxyMhd7DbtUijQhgOjQNyHw5feFBAX+VSp2Y9d1K7c2jmNUHHFTCJIKZRdTILHQn0nd6rW+17kcq+W1wExmF3/3UArEAe2gNIgCVsWjB6TOdOW7U7rVKwBIsMdztuOhb5JhwCeNKaAcbfHFM/NBqa5cBWElQQBwiwVxc5S4l7q09FlnQ98UT2PQmR/8aFVWwLcPzgLu+kzS0fRtstcVIDd3jjZXZjLq+ov4LHeuK4A4s1Cx5IBIZ667ow5dEPmlpoCpUN9N8B8kFypBRBgFjBEHEmGx4BDA1Rt3M36m1bCsUwAAAABJRU5ErkJggg=="], "spr_mobilekey": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAADVklEQVR42u1b63HDIAxWctnDS/i8CHOyiC9LeJL2R6McpQL0JG5T/WquttD36QEIfIFJsm3bh+T5fd8vM+wKG6QGvO/7hUsC9WwUIe5K0XAKxLIsLB3HcTQJ8SbCTRnlXS5gKSGeRJiVaL3sRYaVCPXLs4FHEXHVgscBl2WZDr4eV1JgaxGzVg70CuCUlNEgjQT2w97A6xD21sklgpUCdch7SUoJUkpu+jQpMWQJwW/b9uE5rdXAc86u0ybaPIqEG0chgj+O4zR53wP/sNEeARhGJWgrCZT3UaxRUNuGNaEXBc0aQIHH39TK7NVCOQZ/9+oBScAod7Qk9LwP8FUUtXp7kdMris0aMCp6Z6kJIxtG9eCHl1uhrzWgfI475XFrgcQBrXrAmgV6IomEnLN1OBX4nnxjQ+p9i0FlREirvxY8FQWqzRAls2YH77rzJMDi/VkkWMFT06JbBESTEDXjXJERz16bNwne4Mt1wXMW8NzslCRYdXqDr9cF7ilAkXAW8JSEEmAhYdYq8+qd/x4kzACPdeAGYMt/BDZ6n1sTJEtrzrgtW+BRB9QpcByHaH1fkmAFj4K7R0udEe8FcDBtL69Fgjbsy+U06g8hYARc6oVST0oJcs4mT2qJGBLA9bgmIu73OwAArOsqfr+1s5QSwaoBnq3rWcK1mZUCOeehQuleP6UE67qq3+fY7EIAhhAqbBEh3c+XpGoKWKteuNcAKREcw6mZwLp3CJ8FPIjgNDClJGiBo1wBvpaF0ikIj6e5ucYFJlk2YytNCh6PzgAAbpazdTTYC3xNAqPdrRbcA4XvBrV5PavHGEqARw8vmoQnAZo6EAk+ioQy/58EWOtAFPgoEsoeiHsKRDUzotLhWwoggLOB9yIh9GRoVg/POxLMp8Nc8JqFlnVManz302GJIZLjcQ5BHlFHdoO5UWA5Ee6Bj4o+qvvdrAGjdcEZbocA8BqtvbZ/8x+9KLCAj7ol1rJpdFOsGwGlAg/wkUJFAueaHOumaDmA153eqJuidcNldOrFWgdgPTij52tB8NzjPtZD0feFX3VPmE0AkoB//6Xr8m//wYR4L4ADePcPLOBLm6Tvv/1HU/+fzXkZ9rYfTraIeLtPZ1tEUCBG8qs/nuYSwiFhhl2fusb/5pAMofgAAAAASUVORK5CYII="], "spr_joybase": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAA7CAYAAADFJfKzAAABe0lEQVRo3u2bUQ6EIAxEkeyBuP8peiP3i41rUFrawojMrwXmOWGzwbIFZ6WUdm4tEW2eXswnl8D1hjebzBLSC1o9iSekNXTz4J6QVtBNg0aCaoBFAxAgNdDsQkRQKTCrSAtKRJw13IGrBS2gHDgP+Brw7UMpqAWkFvoO+PIBAqg18EdrxBPyvIZ2XxffADfVHqAFb6y6UrpbYTJYUC1wbFlsJKhm/T9yTqqjQU9+qzXHdJuSfap+1E9L9eC7WpPTZSeLCCr1FUPA/pNvoczHShY1Vam/OHuqWSml/VW/xgv2KPT9KvG5kp1VC3ZWLdhZtWBnVRVWe6LXSxyfK9lZFb2bNlBERBsrWfR9y/UXM/Vow54SH7ihpivxtQ7JZ1XThy2EdKWphtCY7Oj927r+u7/PIgNrQEMwaDPIBpB6Kq60umU0wFbQ3fugNMBSeIgONytgT5n2LiIDu3SlokG79xujAHftJB8FPeyOQE9omNsfntCw93os4L2Ph75h9dpchEh5IgAAAABJRU5ErkJggg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAA7CAYAAADFJfKzAAACS0lEQVRo3u2bS5KFIAxF1XI1TNz/MpywHXuEhQrkJiQgvs6suyDkQMzHh/NkLM65Ax3rvZ8tbVFXzoFrDa+ijALcto3Use+7OXiVghwkAieFr4EWT7yDagCi4FJg9iQUknLLkqA6udCswS1ALYFXCSjHZTljkU0K+sJY59yBAi89QHNQUt1ouiNhpaA5CaDaro4AF2GtQHN/WwNnYa1BewAnYVuBtgZeUAUjCGXvA1azkO8pKY4lN2C0U03ZfQdeqAnaBvRc76ygrN23l6fEFdbjZEd1X4QDKhe/Iss0fScC5yTwXbqe+Og1En2NSNePGbZtu+hJurFlP2o1D7Gd7Gc1A1bKkJR+6ZpxR5XSsZaeV23QlL7c/yVyd9tYnHPHGg/k7B5nXgkoGCh53YrMiTeAlXpSu4Z0NEgFJemMuLEFhpUELY6LIsC1dkGwvdOQln0k7NtBOXaSsKPUyoidkBu/HRi1Dw5QEmBO0JHmW84cVuqRVDtoWpE0+NzNOYsKdGdrTri2gpKsHW/06r2fcyVji1LOuvYO4r2fyUZAo9XiglmlO7MXblKDLdvLy8nGblsD3LMfLtmxTJP9lZzekn27+GV5wI5SC1OS4jif2VIKslo8iGU5Gj+iZi/cOPparXeBjXdhVHeO7b4H3sfJfiUypziK0Xi006XsTcJqu3OLnyxL7luEbQncCrQI2wK4JSgJawncGhSCrQHmXtuT6kYzyE/dSv2/b6wJrSHdbpKXgDXBX/WNAALNgX/91x8ScI688rseLXjrJuQPbtu38CTiwhMAAAAASUVORK5CYII="], "spr_controls_config": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAANCAYAAABfGcvGAAAA2UlEQVRYw+1W0Q7DIAiUpv//y9vLaAgDCoqjLt6bWg5O4tHWNqbj9YHn2xMD6CYAQFYhWXxZNc7Syrm7eXn3It2McldzrqD19CSia+y8lFw7oy/FirPy9dYZvdSo1pGaJN5DSsQLkfa830trLc6TzxIejcvQar06SbdVc2uOF7IiMueCN1fWvCxvSMbloRWmDNVifFnWjEH8CwAB6riLeaLWY5yiHk+82F6ow4uKlc64Z2oeym3kzmsjfzrWeZR/VKu15635ashGPbA5f2FZK0Kz2f1CCiFZ5BscUzf3kIgCqAAAAABJRU5ErkJggg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAANCAYAAABfGcvGAAAA+klEQVRYw+1Y0Q7DIAgcy/7/l93LWMyF49CkkjS9l7aAoIDAZq8GjDGGmZm/I995KJvRGA/1R7rUfpmt22B2AjpEfSt6pj9aE/HVmivxOWmMoXroLFhzFq9mtArKbTEAK/KZk3ZuS0W+Ay210es8ZniU8VkPyfpFxJ9l0J501J37CGY8e+J75ZvRVvfWhbYewsoQczDLeEZnunxNJsd60wkcDUh2UFVe/KnGZKSrMTjT0X1bjmG+HQzKKdVGjvZWdHUE5H3a4Az7QdF2UGnwal0HWgPiDlAlaQfRr/1uZ5f2fdogjp3ReIsOzP5m+R8k6QFRD3nG3gclfAE/B59TLwLg9gAAAABJRU5ErkJggg=="], "spr_controls_opacity": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGsAAAANCAYAAACuEpBLAAAA8ElEQVRYw+1XQQ7EIAhEs///8u6lJMQFxDpo23RuVsFhBLREL9LxPTDr58PO5MdSSkGRRPlDccyKdYVGVS5mA0QWoCH5IYRZGSuCO9FRWZEA5cZWkNacFMmz8/Y7yzOKGV5RjTwbTaPWT9UItou8TOyt18aW3dnMR1bMKC9vzquoiEYtupV1R6Dvod33GmP7YSGE4NYhqwktcLRSMw/2rw2inpmrUQQ4DpTvSFuTa7P0q/Mu9uOuCTaK4VeLdolqY81ee+m0GHl9evMI/54Okb17nC2NzP3oBRFhf+CzuD2iDT4NVlu/XBbtwtUqS2utP5JJIFWXxGHRAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGsAAAANCAYAAACuEpBLAAABTElEQVRYw+1Yyw7DMAgr0/7/l9llkRAy5tF0aqX5VpoQA3FCexyboapasU3sZ3mwMQrA7GfWneJ9lWMLERFVVRERFJy12yStud0kyBfWN5rv+SAezF7dbCjuWyDbrb4Ydpz30VVHlx+zRxyiYrFxu7Ct4mg3ITUxhYUkyc6M/HUSh7iuZ6bIakEeoazMxpRWSQZ7n6kVKSE7ASKe2bhdeO12WMXabdHd0ilUdh8h9SHViMEkpmoTMsUlDQY6QqIL289hzUjkP5sTcakWpZL8Xxx124qFioFUgxS0xlUSGhWlWrBpd4niZDY09yy2FWty6frkoqL6hLDgK6q0vqLPhknsjPMuXP6d5Y+rLHko0M49wtawivdrsLmdONmGux2q3dN6zgrVWSt6z9bt+s94PqbByO6c6OibNCQVLtYnS3znzwp6j7ie5f/Hw/EBhkWe+lotNzsAAAAASUVORK5CYII="], "spr_mobile_pad": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAYCAYAAAAYl8YPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAACMSURBVDjL7ZRBDoAgDAS3hj/xtr5gf9U7r9ITRhEUterFvZCwZbpJAQEAVR1xUyRFPEBZgxfoGxjJ95OF3gQtT1W3MJIro1fLc0PNPLMuNd+zR5JdTdWE5U5Ha6lQbuTYe5PNfgkNtcK97mVdFXaUpgcaWsYV+T50M3MBmRkkxvh/jh/CBAA8hpBSkglnWlDjSmZ1EwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNS0wNy0zMFQwOTowODoxNCswMDowMPIWL2wAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjUtMDctMzBUMDk6MDg6MTQrMDA6MDCDS5fQAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI1LTA3LTMwVDA5OjA4OjE0KzAwOjAw1F62DwAAAABJRU5ErkJggg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAYCAYAAAAYl8YPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAACaSURBVDjLY2AYBaQCRgYGBobKysr/lBrU3t7OyEgNg2CAiZrepL9hdW0P6O8yFmJdgEuuqUoB07C6tgcoEsQCZH1M2CRJoZEBPJ3RxGXkugqnYTCbCNHogAVdAOZsfDELk0c3lAWbQny2o6vDahgh1xBjKAsuCXIAdTP602dPqWLQ02dPId6kloGMDAwMDHHxcRSXtosWLmIEADtTU8Ok5yTdAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI1LTA3LTMwVDA5OjA4OjE0KzAwOjAw8hYvbAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNS0wNy0zMFQwOTowODoxNCswMDowMINLl9AAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjUtMDctMzBUMDk6MDg6MTQrMDA6MDDUXrYPAAAAAElFTkSuQmCC"], "spr_analog_scale": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAMCAYAAAAj+OBEAAAAv0lEQVRIx+VW0Q6AIAjkWv//y/RSjjFTBHS27qWl3nEDUUFExMxMAgBAAWTrrYjh0uMbb/9RQ1laO3o+e0J6TFbEW/0WrxczWz/i+bAQcUOKPN/anMWEVdPrb4Xns0dsGfZyowAA3V4WP9meS/I8Z8aM88wK3YrMzLXk6LGIZ80tyRvZxnLdKC8DOrZ1bdSzjudu2z+jFOGtGq1KtSonebW5Gs9z23pv1Bmet8Ssd2IWTE+VVdg9WRrbbb0vtccFIt4T71LfknoAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAMCAYAAAAj+OBEAAAA00lEQVRIx91X0Q6EMAgbF///l3dPSxoyoDnqNNcXzWSM1kJ0DBHmnDNaX2DiO2ep4llc6oS+UDOzX8gx+/4GlbMY57EOeYvzPt0E2JJ4b2aG68tJPv4OUqcgaw0vUNV2u5hojSYDe6N6mNpYyGdeRNoTY4nsnncEWB2hEFAqHrYsQxJb2+eohMtyK911q3gV2Yy833OKtMp9bfHQZXhFQTC2UzASjgQ49QIk4nk84aTofEVchvanikf2p9HN6wnvZuZJSJyXtapCtDFip0TzU3F2hS/YuAvhTNwTawAAAABJRU5ErkJggg=="], "spr_button_right": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA50lEQVRIx8WWQRbFEAxFy+meMrerrsCuzK1KRxxUIgn+z0grcr1EU+Zi2vM8CZvz3htOjKkTBZFC0UkJhAv9vASA5JzTcoqFEK4YYxO/edgFwoBlsBs0Atrt0QkzJ1X16m4AUJ26EEIZczYKAMlynbngkeX46pr1G5wBl2Aa4K1NDbUOK8tPjz6qjHto+gxQ65aUSUAFpqmPBJR9t9SMm3JTd5BTjTjbfxrxCXW1qhijsZTDLlCjrFe3qrAH5Z/ntF1JoLOsfO4gmCPnOxrZ8A7CAUqNvF3tgvaQKUwLxEBTGBdMAWp7ASsTf87AhjrHAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA70lEQVRIx93WORaCMBQF0BePq5DGlYV1YGFhIesgK7PBbcRGcgL+IRMU/ipMuedlAIB/LZN64zAMnrs2jmNSP+pNEpKLshdzkFT056Ttre8uXakTan7PcJNb9b86aAVxYGi0hijw1Lx3ocyeqbbpjO2tB4Bc7P58hfbjdlUx4DuMtalimKql/+I526bRwCqsBDyXDo30HDeHhy59Npm2wrgRkJ6rSpYDBWzZB3tBq31WW6lDHl5XQP3mllK5yZnjX8R7pYtTAcSclSwWCSKTxelqE8YQ+aWmwFx0m0b8BylFNUTFKDClOEjFUmEJiOsD5vZ+pj+ohEMAAAAASUVORK5CYII="], "spr_c_button": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA8klEQVRIx+2WMRLEIAhF1cmd6L2VJ8it6D1VttJRI/B1LbbYX0UlPCBK9A5USumR1u779ogP00iDrELFxRUICn1NEtETY9zlVDGzyzl3/rvBKZAErA8oiJm7sfVOC7xWopw5l+Zn8khWzOysdQ1YsgtEpO66sWwzFYhmS0RPsCJCS4QEA38z1KGmcAqG6A/7LRgzm8ckFMOZkPODBgJlttIvLVvfdpCdloS0qiL4UEslXekutRHvvGypDSzn7INmcArUZTZm922GI8j8ee50fKsqrzuIZIjs1JmmdxAEuCr1dnUKOkJM2C5QApkwFKwBWn0AjX+RzqIc/0sAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAABBElEQVRIx+2WMRKDIBREVyenSJqcDM9hCosUeg45mY25hikyOGD4/y/GIpPJVgrMPhf4IPCrqtiBbdsuUt8wDJSPOUiDlELFzhIIC31rdI1bLufLXs6q+THDjz7xT16OAknA9YEFdf2UvN9vVxp4Yr8yQLbmUntOFZOq6yfVzAKGdLVrnLrrttOWU4BoY13jlhoApFQlU6Qp+NNrxqbTVB8FY/SHfRes6yezTGrgVXQ5MfXDKPibyZgtzdbjelwBcnFrhsxRBQB+9BVd1NKUlpwuyRVjpStVnArIrJm0WfaCssnidJ8mjEHZmzoHLIVu06j/IHuhFsSE5YCMJJAJY8EaINYTQsyPw9J/MnUAAAAASUVORK5CYII="], "spr_z_button": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA9klEQVRIx7WWyRXFIAhF0ZOe2NtVKkhX7K3KvzLHmDAp/62MEi7gmMCo8zwbN3ZdV7L4UI0kiBfKDnogVuirExFbKWWVc4uIoNb68P/4iAJxwLvxBSIiN+DLRwceq064TCRlS/l2SltKAURsAAC5N/4tRGx5N/IuImL99H5xzqxBSKBR5gXCQTxBuWHjivOW3wzzZrEMs86JphwFIiLbpuaMojLq/tXMInXDVg5dy7/jmLpAdoKYlQAAxvMx+j7rqrWmLBlEgR6ZzdntZjiD1Mtz5cTQqvJ6g3CGElSCfL5BLECvxNdVFHSGqLBVIAdSYVawBBj1A4r3ivATBeFTAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAABA0lEQVRIx92WMRaDIAyGI6+nkKUnw3PYwaGDnkNO5oLXoFN82BKSIC79pyi8fPwhggD/qk46cRzHSI0tyyLKw04qQbRQclADkUJ/XrrBRdvbWs6hsAfwqz/lPz20AlHAI8iBpnlTA96vJwl81CbJiVuckZRPAqJkewtucBEAwGBwt9zgokH6VU3zRlYA8xf3TFq+EiiVuEEoiGZRaljacdrGEcO0Lqph0j3hZFqBpnmTfdRhD7c6wvyss5YyeEhS7iQqlQ/z+tV3bIPUnPyUTlcMQJujK+cKILNnV8rJ5fm5qTG+4jAFZW/qHFAL/XZT/AephXIQFpYDSkSBWJgUXAKk+gDkT4qVw5m/AwAAAABJRU5ErkJggg=="], "spr_h_button": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA40lEQVRIx92WTQ7EIAiF0fRO7L1VT+Ct2HsqZ2WjVgX8mUnm7VqRLw9twYBQ933H3pr33khysEEjiBbaXdRApNDXS0SMzrlZziMighBCkb942AXqAa0URETqNeccIOJzHBYEmgG1ZE+Ur+fO5jZPChGjTfSTSvlFZ5akOZ+WLu2GFaAK1iq3+jZ+S38OW71lnFL+35SRczf68KU/cJGzWVAtAwBFG9jdz5JCCMaOAnaBCme1u1WHNSh164vboIFyVXnNIL3A2ZEhn0Ga09Vs+UagJmwHtIawsFlgD8TCpOARINcHltlzuza6a2wAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAbCAYAAACN1PRVAAAA6klEQVRIx92WvRHDIAyFMZcpTJPJ5DlIkSJFPIeZLA1ew6nkw7YAiZ8UeZWxQN89xCEGxZS1dovF5nkeODmyk1IQKTQalEC40MtPmGAzoynl7PKrV25xh/yHQStQDKi5oOf7I46Z0SiYYC+HVgyVgCjpHtsXc6dDmz0FE2wa6T2F+Vk1Q0nqQ+kmXVADFMFej3sVXLSNtfpzmF99Vwjm/60zvJVz7qiTyIlhXre4geWsFHTW3mvwjmzdz9CVUkTNWh0WKs+lU+N3jcMQFHZq8g0SjiXQs5vkG6QUmoNkYRSQoxgoC+OCU4BQXxaic2ByaRDkAAAAAElFTkSuQmCC"], "spr_settings_mobile": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAYCAYAAAAYl8YPAAAAgElEQVQ4y+2UQQrAIAwEN+KfvPsrX+Cvcs+r2lM9lKiRSKG0ORlYh7BLQgBQSjngrFor0QzEzO2dcx4CgxWk9Uuw1XoOdvdo5lnseXJ91AC9UIIm0HqL7gUBWM0e6f4N2AxzbYAFOJxsZqq1mBmUUnJf2TbZLtCHYAQAO0IQEToB/Lo4qFkWwGsAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAYCAYAAAAYl8YPAAAAgUlEQVQ4y2NgGAWkAkYGBgaGysrK/5Qa1N7ezshIyKC6tgdwdlOVAl4DmYg1CBufJMNIBfQzDD2MCIUZC64wgWnEZgCuSGHCpgAbnxh1QyACiA1sfOpGcwCVDaMoBxBjIF6XPX32lCpefPrsKcRl1DKQkYGBgSEuPo7iYnvRwkWMAEqcO0c3HNc8AAAAAElFTkSuQmCC"], "spr_button_restart": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAABR0lEQVRIDeWWzbGDMAyEQyY9cacrKqAr7lRFZj1vM4tiSVaS2/PFtrTazz8EMt0G27qupyfdtm3ychpPRRFEjTDOoC6sAhmFvsHmeT6XZbH15fm+77fjOC7+l8mvQFyZBb5gGQiFXuNJUMM59Ap8eAaM04DzXj+iQV2DebuyJrpiQq2GcfZ/NSfu7w4QE1HfA0Hvxa0XOHevQFccGarOAjhnfYMx2Osp7OWqsfQByQwri0l3lsEq+X8MG3nacJTQZdp2jD2RXnwvr3c1mh++M8/Qi+tiOJ70DaK7oaBiltWnvzMaRFBquECvb5+YbHdecRbXBbYXsS1Qgc1V5j2fy8dTzUaPRms4tiD+PXDvjAUVKGsItf1rZ0jo3VlhBI0g3BX8LjAEIiDylaYg1L3BaPYN1ELo6cIg+ATogeAXwiBgi8ARgPXon+m+k366k6vbAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAABUUlEQVRIDeWWS5LCMAxEMylOQTZzMjhHWLBgMTkHnGw2cA2odlWnOkok2cWsBi9wJLf6WfnSdf91fNU2No7j09NO01Tlk4oiiIVnUBfWAqmFrmCH4+E57Adb3xzfH/fudr0t/BfBX4G4MwucYRno/PNLj9V8OX2XHDWMkVTgrqiCHxoEkq5Gg/rSmdeVNdEdE241yFsdu+sBYmE0WwNqvTzXOYPTI9i6+3THkaHqaGxn+heYXdQ4Aqmu5ji9QTKTls2knWWwlvUPhtXcbTiV0GXachrx0NmhFz4zydbpX33NPEMvbzePeH5dIeDDh2OOFjM9G6xnV/jcpM8ZDSIoNQR4c+kMi3xHbnXnFWd57Qra1TWjIDPK1rd85s5QzO5w/E6HCtK/BguYBbZCFYJaBSFewZDE0C4RR51mENRjuDAsWiBy2bDdqD6EqTACRwD1eAGi7JFTkAqLBQAAAABJRU5ErkJggg=="], "spr_black_mobile": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA10dzkAAAIyUlEQVR42u3WMQEAIAzAsIF/z+ACjiYKenbNzBkAADL27wAAAN4ygAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIMIABAjAEEAIgxgAAAMQYQACDGAAIAxBhAAIAYAwgAEGMAAQBiDCAAQIwBBACIMYAAADEGEAAgxgACAMQYQACAGAMIABBjAAEAYgwgAECMAQQAiDGAAAAxBhAAIMYAAgDEGEAAgBgDCAAQYwABAGIuiRQEv+nmKPoAAAAASUVORK5CYII="], "spr_analog_type": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAAAMCAYAAADBJPs9AAAAs0lEQVRIx91XWxKAIAiExvtf2X7SYXZKEWGi9k+LXR4ixUREtdZKAszMtAFvvhl/lE4Xk4K49uSO9j0CZeYA7skqWU/KyG6mqeVuNnJtiefQiPIFSSKF8Zk2AA1nBFbiKTsiUQFkQk+QpZej+/8NYEw9QSttIt9btcsO7Axzi/0dreBbd9DTmMU9vADRrlVtxOnh151/I+3096zHd47ksPCpxvxXE+KBdEfI4zfliQMHiwYnnXrzx6m+ZMoAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAAAMCAYAAADBJPs9AAAA6UlEQVRIx8VWSQ7EMAgr1fz/y8ylSJEFmEAXXxrRhNWQHMcAqqqR3FDZP7H1tI7f1KhnWESk4yyeU1X1dHnyKHgRkUjP42AMqTCIVdX+45f5461fY5BnXC5Ytdaq4X5WzSixXqCfMGOSqJ3AK+cqDNIE7CzDeXfC2IDecdJjm7ETZbYP19OYxkN6bbEoKBag1zKoB9f4P7P7ehtGLMFgUdZpscq+ant3WmyU2XUghwZIlXeubKaf6e3glndQlerdoL2b0UsIk33SauhIdrPttlg07Ls3ZgdtBmXBT53Dwb8C31ZZi1de6wx/6lCnM4MENuIAAAAASUVORK5CYII="], "spr_reset_config": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAMCAYAAAAj+OBEAAAAz0lEQVRIx+1W2w7FIAiTxf//ZfayLZwGZyHO45L1TcRaLl5K+fADPcD4Vs9RRGSGyN5eqG2kLsud5RUMgglqRvKe1JXh8pqsRhfZDTNzaM8mheVnuZlYcI+NIZQD1padszZv3EKPywve02X97JjVYVEtUaRSXnDRNbMx+gq4kmeJVVXvjuDpj5VEMeyr9VZ077xS2hXCBGPSn3gdV+rwLeJsOy3yH4r4rgg8lZe99yUY/dpiUtl5lp/54tzZWonzdC1zBFZGsyD/FvYWeJ2+A1ssHBCGBvhkAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAMCAYAAAAj+OBEAAAA6UlEQVRIx82WSQ7FMAhDi9T7Xzl/FQkhG5PpN6yqDCR+Yag9m6y11szM4ne2XvlUPip3QWfN+o327nCyKq6yPgpH8PucmVk8I9t3Dbx+OSaui1IilHAV5bui66h5WBk4tq8yx/xWo8ivuzby0GtnKVoVgtIQAY0RzdK3r1mNzr/VPASxAhV9+9rG5jJA1zYMX9NUXRrpuKxWqubDztgBcBle5RLs9Ue77ozoLOVX7VjaVv/zTkaG94Uy4hpDMFSXROAYzJnx2e78CTxV6LN9SKwSPvIII79Rn8CrCI3AMphxrAKH+VNjM/YD4EyLdYu3gg0AAAAASUVORK5CYII="], "spr_arrow_leftright_mobile": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAJCAYAAACvzAXAAAAAR0lEQVQ4y83ROQ4AMAgDQZz//9lpohTIOTp7K0TDSFS1SLKMqfsjCfh0cOUGHi1JQGXCHgC4YQoq1SnFv/xqSYB+GRKQfTcBbKxvmOKd70UAAAAASUVORK5CYII="], "spr_button_down": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA7klEQVRIx+WWuxHDIBBEF8Y9XU5XqkBdXU5VOIKRENwHYyfeCIljnxYNnwCjjuMos77zPIPFQy2SIF7otNMDsUIfL4mopJRWOU3MjJzzzf/2sAs0A7aGFcTMAADrR12BcVsMg6In1YpSSiCiAgCxNr4tIiqx0r+p6v/7f/afMGZua2ulfynZyNAKccN6cy+owaSBlmWh1VR/UzLJzLNGG0yblpGpZ+M2JxuZr+w6AQCu++Pu86wq5xyiVLALdEvWp/s0YQ+qh+dLG+CBarPyuIPMCiWoBBneQSxAr8Tb1S5oD1Fhq8AZSIVZwRLgqjc7TH1uq8IvYgAAAABJRU5ErkJggg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA+ElEQVRIx+WWPRaDIBCER44hTU4G5zCFRQo9h5zMBq9BmsBDw88u0RTJVOjum++NyCrwq+qojcMwuFxtnmeST7WpBOFCs0UOhAp9u6m0crKXrZwgu1mYxez8dxdngXLAsKCCxmkFADzuNzZQnBaDIMFJ1SLZSyitHAAIv7haSisnPP1Kef/v79l/wsZpDWerpd6ULGVIhbBhR3MuKMDsZrMNlLFU6/H+pGQlM+qMBF6D2E+R2uE+PjoKyKcyi+lYexabcxLtknHScRSnAhJ7VnpZWkDJZHG6TxPGoOSXOgXkQo9piv8grdAapApLASnKgaowKrgEiPUEvF18WqY4aAkAAAAASUVORK5CYII="], "spr_button_up": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA50lEQVRIx92WSxKEIAxEA+WdsudWnsBbsc+pcIWFH0gnMjNV0yuE2C+JlBAI1Lqupbe2bVtAPNSgEcQK7S5aICj0NsnMJaXk5RzKOZOInPxPD7NAPeAxQEE5ZyIiQpNqgdGa6dMYVUCr6pmj3RCREJlZ3XWjKtAKmblELTvETIup/qZv1ibl2bUw7MncClw8EC/Q1Ma3+nOY529gUfX/TRs/VV3r+9XKjh9xnZh9nlWJSIijgFmgU2XX6t5WeAXVw3PRXrBAta7c7iC9QO8x9HgHQYBWDW9Xs6BXiArzAnsgFYaCR4BWO22FfJsFHPcJAAAAAElFTkSuQmCC", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA8ElEQVRIx92WPRaDIBCEh7ycIjY5GZ7DFClSxHPIyWzwGqbJ+kD52QW1cCoU3nwOCAtwVSnuwK7r5lhf3/csn+ygFEQKjXZKIFzo5qVu9dw8mlLOIjtZmMF4/t7DXqAYcGlwQe/vCAD4vJ5i4E3ypQRat7lS3FQxc05CSqd0q2cASMFyKXJAO1kA/2msAXHGkL9ozdwE3B/EFRsWMpcC7yWQUqBoGmt1cRjtg6Pk7bPTktEheVQ68jWDUacm80oMkD66alIBgTXbazpDPptKTe2ahC4oWKlDQCl0nSZ5BymF5iBZWAjIUQyUhXHBKYCrH2lpfQl4hvroAAAAAElFTkSuQmCC"], "spr_x_button": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAAA/UlEQVRIx72WTRqEIAiGP326E3tv1Qm6FXtP1aycoRKBxvpWpsQriD8JTq3rumtj27Yljw/TaASJQtXBCMQLvXQS0V5Kucv5iplRaz34P3zMAmnAb6MHYmYAgGcCmq0E5mlhOJSfSJ9UKQVEtANAbo2nRUR7bnRtVsBvPTRZa9v6zTXzptdjt3gd9WYfqVY3TDqUKY0WlRv2WmTM3HUoo/UAzQKxKjFil0eG3jRZW6T1v39cRdIVlfT7amQJAOT5OPs+a6q1pjwymAU6RHaO7t8Iz6B2eS7WDxGolZXLG0QzHEFHkO4bxAOMavi6mgU9Q0zYXaAGMmFe8Agg9QF1eZHIGYNQYQAAAABJRU5ErkJggg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAdCAYAAABbjRdIAAABCklEQVRIx92WPRKDIBCFn0xOIU1OhucwhUUKPYeczMZcgxSZdTBZ2MW/Iq9C2Xkfu4sg8K+qtIFt24bU3DAMKh8xKAcphSYnSyBa6M9L17hga7uVs2h+zfCjX/mvHo4CpYDLgAN1/QQAeD7uonEqNgaaw9JQyJxRvli2tnCNCwBgaHC2XOOCITonqj/1IyWpt+Qv9kyzObRxN60Rt/qS3aqGxYZxSbWQYthlmXX9xBrG2WqA4gaRdmJJnAE+R0rOQFq19ImQ/7XHFR2Sqez2inz96KtLM1tdMUD66NqbFcD07Khycj4/NzWN92QYg9ibmgOWQr+zyf6DbIVKEBHGATVKgUSYFpwDxHoD2IGTGxjMsLgAAAAASUVORK5CYII="] };

    const MOBILE_FONT_NAME = 'MobileFont';
    const MOBILE_FONT_B64 = "data:font/truetype;base64,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ABgAGQAaABsAHAAdAB4AHwAgACEAIgAjACQAJQAmACcAKAApACoAKwAsAC0ALgAvADAAMQAyADMANAA1ADYANwA4ADkAOgA7ADwAPQA+AD8AQABBAEIAQwBEAEUARgBHAEgASQBKAEsATABNAE4ATwBQAFEAUgBTAFQAVQBWAFcAWABZAFoAWwBcAF0AXgBfAGAAYQAAAIQAhQCHAIkAkQCWAJwAoQCgAKIApACjAKUApwCpAKgAqgCrAK0ArACuAK8AsQCzALIAtAC2ALUAugC5ALsAvADSAHAAYwBkAGgA1AB2AJ8AbgBqAN4AdABpAAAAhgCYAOUAcQDoAOkAZgB1AN8A4gDhAAAA5gBrAHoAAACmALgAfwBiAG0A5AAAAOcA4ABsAHsA1QADAIAAgwCVAAAAAADKAMsAzwDQAMwAzQC3AAAAvwAAANgAZQDWANcA6gDrANMAdwDOANEAAACCAIoAgQCLAIgAjQCOAI8AjACTAJQAAACSAJoAmwCZAMAAwQDIAG8AxADFAMYAeADJAMcAwgAAAAAADgAOAA4ADgAqAEAAegCgANYBBgEUAS4BSAFuAYgBmAGmAbQB2gHwAgICIgJAAlYCcgKMAqoCzALmAvwDEgNAA1YDggOiA8wD7AQOBC4ESgRqBIYEpAS+BNgE8AUQBSAFRAViBXgFmAW+BeQGBAYYBi4GRgZsBpIGsAbKBt4HBAcYB04HXAdqB4oHrAfMB+gICAgkCEIIXAh2CI4Irgi+COIJAAkWCTYJXAmCCaIJtgnMCeQKCgowCk4KaAqCCpAKqgrQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK0ArQCtAK7gruCu4K7gruCu4K7gruCu4K7gruCu4K7gruCu4LBAsECyoLKgs4C0YLWAtoC2gLhAugC6ALoAugC7oL1gvWC9YL1gvWC9YL1gvWC9YL1gvWC9YL1gvWC9YL1gvWC9YL1gvWC9YL1gvWAAAAAQAAAAAEAAUAAAMAAAERIREEAPwABQD7AAUAAAIAAAAABAAFAAADAAsAAAERIREBESERIREhEQEA/wACAP8AAwD/AAEA/wABAAIA/wADAP8A/wAAAgAAAwADAAUAAAMABwAAAREhESERIREBAP8AAwD/AAUA/gACAP4AAgAAAAACAAAAAAUABQAAAwAfAAABESERKQERIREhESERIREhESERIREhESERIREhESERIQIAAQD+AP8AAQABAAEAAQABAP8AAQD/AP8A/wD/AP8AAQADAP8AAQABAAEA/wABAP8A/wD/AP8A/wABAP8AAQABAAAAAAEAAAAABQAGAAATAAABIREhESERIREhESERIREhESERIQMAAgD+AAEA/wD/AP4AAgD/AAEAAQAFAP8A/wD+AP8AAQABAAEAAQACAAAGAAAAAAQABAAAAwAHAAsADwATABcAAAERIREBESERAREhEQERIREhESERAREhEQEA/wACAP8AAgD/AAIA/wD+AP8ABAD/AAEA/wABAAEA/wABAAEA/wABAAEA/wABAP8AAQD9AP8AAQAAAAADAAAAAAUABQAAAwAHABcAAAEhESEBESERAREhESERIREhESERIREjEQIAAQD/AP8AAQD+AAEAAwABAP8AAQD+AP8DAAEA/gD/AAEA/gADAAIA/gD/AP8A/wABAP8AAAABAAADAAEABQAAAwAAAREhEQEA/wAFAP4AAgAAAQAAAAADAAUAAAsAAAERIREhESERIREhEQEAAgD/AAEA/gD/AAQAAQD/AP0A/wABAAMAAAEAAAAAAwAFAAALAAABIREhESERIREhESEBAP8AAgABAP8A/gABAAQAAQD/AP0A/wABAAABAAAAAAUABQAAEwAAASERIREhESERIREhESERIREhESEEAAEA/wD/AP8A/wD/AAEAAQABAAEAAwD/AP8A/wABAAEAAQABAAEA/wAAAQAAAAAFAAUAAAsAAAEhESERIREhESERIQIA/gACAAEAAgD+AP8AAgABAAIA/gD/AP4AAAEAAAAAAgACAAAFAAApAREhESECAP4AAQABAAEAAQAAAQAAAgACAAMAAAMAAAERIRECAP4AAwD/AAEAAAEAAAAAAQABAAADAAABESERAQD/AAEA/wABAAAEAAAAAAQABAAAAwAHAAsADwAAAREhEQERIREBESERAREhEQEA/wACAP8AAgD/AAIA/wABAP8AAQABAP8AAQABAP8AAQABAP8AAQAAAgAAAAAEAAUAAAMABwAAAREhEQERIREBAAEAAgD8AAMA/gACAAIA+wAFAAABAAAAAAMABQAABQAAASERIREhAQD/AAMA/gAEAAEA+wAAAAABAAAAAAQABQAADwAAASERIREhESERIREhESERIQIA/gADAAEA/wABAPwAAQABAAQAAQD/AP4A/wD/AAIAAQAAAQAAAAAEAAUAAA0AAAEhESERIREhESERIREhAQABAP4AAwABAPwAAgD/AAMAAQABAP4A/QABAAEAAAAAAQAAAAAEAAUAAAkAABkBIREhESERIREBAAEAAgD+AAEAAwD/AAIA+wABAAABAAAAAAQABQAADQAAESERIREhESERIREhESEEAP4AAgD/AP0AAQD/AAUA/wD/AP4A/wABAAEAAAIAAAAABAAFAAAHAAsAADERIREhESERAREhEQMA/wACAP0AAQAFAP8A/wD9AAIA/wABAAABAAAAAAQABQAADQAAASERIREhESERIREhESECAP4ABAD/AP8A/gABAAEABAABAP4A/wD+AAIAAQAAAAADAAAAAAQABQAAAwAJAA0AAAERIREBESERIREBESERAgABAP0AAQADAP0AAQAEAP8AAQD8AAQAAQD7AAIA/wABAAAAAAIAAAAABAAFAAADAAkAAAERIREBIREhESECAAEA/wD+AAQA/gAEAP8AAQD9AAQA+wAAAAACAAABAAEABAAAAwAHAAABESERAREhEQEA/wABAP8ABAD/AAEA/gD/AAEAAAIAAAAAAQAEAAADAAcAAAERIREBESERAQD/AAEA/wAEAP8AAQD+AP4AAgAABQAAAAADAAUAAAMABwALAA8AEwAAAREhEQERIREBESEZAiERAREhEQEA/wACAP8AAgD/AP8AAgD/AAMA/wABAAEA/wABAAEA/wABAP0A/wABAP8A/wABAAAAAAACAAABAAQABAAAAwAHAAABESERAREhEQQA/AAEAPwABAD/AAEA/gD/AAEAAAUAAAAAAwAFAAADAAcACwAPABMAAAERIREBESERAREhGQIhGQIhEQEA/wACAP8AAgD/AP8A/wAFAP8AAQD/AP8AAQD/AP8AAQD/AP8AAQD/AP8AAQAAAAACAAAAAAQABQAAAwANAAABESERASERIREhESERIQEA/wACAP4ABAD/AP4AAQABAP8AAQADAAEA/gD/AAEAAAAABAAAAAAFAAUAAAMABwAPABMAAAERIRkCIREBIxEhESERIQERIREEAP0AAQD+//8BAAIA/f8EAf8ABQD/AAEA/QD/AAEA/wADAP8A/QAEAP0AAwAAAgAAAAAEAAUAAAMADQAAAREhEQERIREhESERIRECAAEA/QABAAMA/wD/AAMA/wABAP0ABAABAPsAAQD/AAAAAAMAAAAABAAFAAADAAkADQAAASERIQERIREhEQERIREDAP8AAQD9AAMAAQD9AAEAAgD/AP8ABQD+AP0ABAD/AAEAAAAAAgAAAAAEAAUAAAUADQAAASERIREhAREhESERIRECAP8AAwD+AP4AAQABAAIABAABAP4A/QAEAP0AAQD+AAAAAAIAAAAABAAFAAADAAsAAAERIREBESERIREhEQEAAQD+AAMAAQD/AAMA/gACAP0ABQD/AP0A/wAAAgAAAAAEAAUAAAMADQAAAREhEQERIREhESERIREEAP0A/wABAAMA/gACAAUA/wABAPsABAD/AP8A/wD/AAAAAAIAAAAABAAFAAADAAsAAAERIREBESERIREhEQQA/QD/AAEAAgD/AAUA/wABAPsABAD/AP8A/gAAAQAAAAAEAAUAAA0AAAEhESERIREhESERIREhAQD/AAEAAwD+AAEAAQD9AAEAAwABAP8A/gABAP0AAAAAAQAAAAAEAAUAAAsAAAERIREhESERIREhEQIA/gACAAEAAQD/AAEA/wAFAP0AAwD7AAEAAAEAAAAABAAFAAALAAABIREhESERIREhESEBAP8ABAD/AAEA/AABAAQAAQD/AP0A/wABAAABAAAAAAQABQAACQAAASERIREhESERIQIA/gAEAP8A/QACAAQAAQD8AP8AAQAAAAABAAAAAAQABQAADwAAAREhESERIREhESERIREhEQEA/wABAAEAAgD/AAEA/gACAP4ABQD/AAEA/wD/AP0AAgAAAQAAAAAEAAUAAAUAADERIREhEQIAAgAFAPwA/wAAAAABAAAAAAUABQAAEQAAASERIREhESERIREhESERIREhBAABAP8A/wD/AP8A/wACAAEAAQAEAPwAAgD+AAEA/wAFAP8AAQAAAAABAAAAAAQABQAADQAAAREhESERIREhESERIREBAP8AAQABAAEAAQD+AAEA/wAFAP8A/wACAPsAAQAAAAACAAAAAAQABQAAAwAHAAABESERAREhEQIAAQABAPwAAwD+AAIAAgD7AAUAAAIAAAAABAAFAAADAA0AAAERIREBESERIREhESMRAgABAP8A/gADAAEA/wMA/wABAP4A/wAFAP8A/gD/AAAAAAACAAAAAAQABQAAAwARAAABESERASMRIREhESERIREhESEBAAEA/v//AQACAAEA/wABAPz/AwD+AAIA/gADAAEA/wD+AP8A/wAAAAAAAgAAAAAEAAUAAAMAEQAAAREhEQERIREhESERIREhESERAQABAP4AAwABAP8AAQD/AP8ABAD/AAEA/AAFAP8A/wD/AP4AAQD/AAAAAAEAAAAABAAFAAAPAAABESERIREhESERIREhESERAwD9AAEA/wABAAMA/gACAAEA/wABAAEAAgABAP8A/wD+AAABAAAAAAQABQAABwAAASERIREhESEBAP8ABAD/AP4ABAABAP8A/AAAAQAAAAAEAAUAAAkAADERIREhESERIREBAAEAAgD/AAUA/AAEAPwA/wAAAAACAAAAAAQABQAABQAJAAAxESERIREBESERAgABAAEA/wAFAPwA/wAFAPwABAAAAAABAAAAAAUABQAAEwAAASERIREhESERIREhESERIREhESEBAP8AAQABAAEAAQABAP8A/wD/AP8AAQAEAP8AAQD/AAEA/AD/AAEA/wAAAQAAAAAEAAUAABMAAAEhESERIREhESERIREhESERIREhAQD/AAIAAQABAP8AAQD+AP8A/wABAAQAAQD/AAEA/gD/AP4AAgD+AAMAAAEAAAAABAAFAAANAAABIREhESERIREhESERIQIA/gACAAEAAQD/AP0AAgADAAIA/wABAPwA/wACAAAAAAEAAAAABAAFAAALAAABIREhESERIREhESECAAIA/AADAP4AAwD+AAEA/wADAAEAAQD9AAABAAAAAAMABQAABwAAAREhESERIREDAP8AAQD9AAUA/wD9AP8ABQAABAAAAAAEAAQAAAMABwALAA8AAAERIREBESERAREhEQERIREBAP8AAgD/AAIA/wACAP8ABAD/AAEA/wD/AAEA/wD/AAEA/wD/AAEAAAEAAAAAAwAFAAAHAAABIREhESERIQEA/wADAP0AAQAEAAEA+wABAAAGAAACAAUABQAAAwAHAAsADwATABcAAAERIREhESERAREhEQERIREBESERAREhEQEA/wABAP8AAgD/AAIA/wACAP8AAgD/AAMA/wABAP8AAQABAP8AAQABAP8AAQD/AP8AAQD/AP8AAQAAAAABAAAAAAQAAQAAAwAAAREhEQQA/AABAP8AAQAAAQAAAwABAAUAAAMAAAERIREBAP8ABQD+AAIAAAIAAAAABAAFAAADAA0AAAERIREBESERIREhESERAgABAP0AAQADAP8A/wADAP8AAQD9AAQAAQD7AAEA/wAAAAADAAAAAAQABQAAAwAJAA0AAAEhESEBESERIREBESERAwD/AAEA/QADAAEA/QABAAIA/wD/AAUA/gD9AAQA/wABAAAAAAIAAAAABAAFAAAFAA0AAAEhESERIQERIREhESERAgD/AAMA/gD+AAEAAQACAAQAAQD+AP0ABAD9AAEA/gAAAAACAAAAAAQABQAAAwALAAABESERAREhESERIREBAAEA/gADAAEA/wADAP4AAgD9AAUA/wD9AP8AAAIAAAAABAAFAAADAA0AAAERIREBESERIREhESERBAD9AP8AAQADAP4AAgAFAP8AAQD7AAQA/wD/AP8A/wAAAAACAAAAAAQABQAAAwALAAABESERAREhESERIREEAP0A/wABAAIA/wAFAP8AAQD7AAQA/wD/AP4AAAEAAAAABAAFAAANAAABIREhESERIREhESERIQEA/wABAAMA/gABAAEA/QABAAMAAQD/AP4AAQD9AAAAAAEAAAAABAAFAAALAAABESERIREhESERIRECAP4AAgABAAEA/wABAP8ABQD9AAMA+wABAAABAAAAAAQABQAACwAAASERIREhESERIREhAQD/AAQA/wABAPwAAQAEAAEA/wD9AP8AAQAAAQAAAAAEAAUAAAkAAAEhESERIREhESECAP4ABAD/AP0AAgAEAAEA/AD/AAEAAAAAAQAAAAAEAAUAAA8AAAERIREhESERIREhESERIREBAP8AAQABAAIA/wABAP4AAgD+AAUA/wABAP8A/wD9AAIAAAEAAAAABAAFAAAFAAAxESERIRECAAIABQD8AP8AAAAAAQAAAAAFAAUAABEAAAEhESERIREhESERIREhESERIQQAAQD/AP8A/wD/AP8AAgABAAEABAD8AAIA/gABAP8ABQD/AAEAAAAAAQAAAAAEAAUAAA0AAAERIREhESERIREhESERAQD/AAEAAQABAAEA/gABAP8ABQD/AP8AAgD7AAEAAAAAAgAAAAAEAAUAAAMABwAAAREhEQERIRECAAEAAQD8AAMA/gACAAIA+wAFAAACAAAAAAQABQAAAwANAAABESERAREhESERIREjEQIAAQD/AP4AAwABAP8DAP8AAQD+AP8ABQD/AP4A/wAAAAAAAgAAAAAEAAUAAAMAEQAAAREhEQEjESERIREhESERIREhAQABAP7//wEAAgABAP8AAQD8/wMA/gACAP4AAwABAP8A/gD/AP8AAAAAAAIAAAAABAAFAAADABEAAAERIREBESERIREhESERIREhEQEAAQD+AAMAAQD/AAEA/wD/AAQA/wABAPwABQD/AP8A/wD+AAEA/wAAAAABAAAAAAQABQAADwAAAREhESERIREhESERIREhEQMA/QABAP8AAQADAP4AAgABAP8AAQABAAIAAQD/AP8A/gAAAQAAAAAEAAUAAAcAAAEhESERIREhAQD/AAQA/wD+AAQAAQD/APwAAAEAAAAABAAFAAAJAAAxESERIREhESERAQABAAIA/wAFAPwABAD8AP8AAAAAAgAAAAAEAAUAAAUACQAAMREhESERAREhEQIAAQABAP8ABQD8AP8ABQD8AAQAAAAAAQAAAAAFAAUAABMAAAEhESERIREhESERIREhESERIREhAQD/AAEAAQABAAEAAQD/AP8A/wD/AAEABAD/AAEA/wABAPwA/wABAP8AAAEAAAAABAAFAAATAAABIREhESERIREhESERIREhESERIQEA/wACAAEAAQD/AAEA/gD/AP8AAQAEAAEA/wABAP4A/wD+AAIA/gADAAABAAAAAAQABQAADQAAASERIREhESERIREhESECAP4AAgABAAEA/wD9AAIAAwACAP8AAQD8AP8AAgAAAAABAAAAAAQABQAACwAAASERIREhESERIREhAgACAPwAAwD+AAMA/gABAP8AAwABAAEA/QAAAQAAAAADAAUAAAsAAAEhESERIREhESERIQEA/wABAAIA/wABAP4AAgABAAIA/wD9AP8AAAEAAAAAAQAFAAADAAABESERAQD/AAUA+wAFAAABAAAAAAMABQAACwAAASERIREhESERIREhAQD/AAIAAQD/AP4AAQAEAAEA/gD/AP4AAQAABAAAAwAEAAUAAAMABwALAA8AAAERIREBESERAREhEQERIREBAP8AAgD/AAIA/wACAP8ABAD/AAEAAQD/AAEA/wD/AAEAAQD/AAEAAAMAAAAAAwAFAAADAAcACwAAAREhEQERIREBESERAwD9AAIA/wABAP8AAwD/AAEAAgD/AAEA/AD/AAEAAAIAAAIAAwAFAAADAAcAAAERIREBESERAQABAP4AAwAEAP8AAQD+AAMA/QAABAAAAwAEAAUAAAMABwALAA8AAAERIREBESERAREhEQERIREBAP8AAgD/AAIA/wACAP8ABAD/AAEAAQD/AAEA/wD/AAEAAQD/AAEAAAEAAAIABAADAAADAAABESERBAD8AAMA/wABAAABAAACAAQAAwAAAwAAAREhEQQA/AADAP8AAQAAAQAAAwACAAUAAAUAAAERIREhEQEA/wACAAQA/wACAP8AAAAAAQAAAwACAAUAAAUAABkBIREhEQEAAQADAAEAAQD+AAACAAADAAUABQAABQALAAABESERIREhESERIREBAP8AAgACAP8AAgAEAP8AAgD/AP8AAgD/AAAAAAIAAAMABQAFAAAFAAsAAAERIREhESERIREhEQEAAQD+AAQAAQD+AAQAAQD+AAEAAQD+AAEAAAAAAQAAAQADAAQAAAsAAAERIREhESERIREhEQEAAQABAP8A/wD/AAMAAQD/AP8A/wABAAEAAAMAAAAABQABAAADAAcACwAAAREhESERIREhESERAQD/AAMA/wADAP8AAQD/AAEA/wABAP8AAQAAAAAoAeYAAQAAAAAAAAA0AAAAAQAAAAAAAQAWADsAAQAAAAAAAgAHADQAAQAAAAAAAwAjADsAAQAAAAAABAAWADsAAQAAAAAABQArAF4AAQAAAAAABgAUAIkAAQAAAAAACgA/AJ0AAwABBAMAAgAMAzYAAwABBAUAAgAQANwAAwABBAYAAgAMAOwAAwABBAcAAgAQAPgAAwABBAgAAgAQAQgAAwABBAkAAACeARgAAwABBAkAAQAsAcQAAwABBAkAAgAOAbYAAwABBAkAAwBGAcQAAwABBAkABAAsAcQAAwABBAkABQBWAgoAAwABBAkABgAoAmAAAwABBAkACgB+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";
    let mobileFontReady = false;
    (function () {
        const ff = new FontFace(MOBILE_FONT_NAME, 'url(' + MOBILE_FONT_B64 + ')');
        ff.load().then(function (loaded) {
            document.fonts.add(loaded);
            mobileFontReady = true;
        }).catch(function (e) {
            console.warn('MobileFont load error:', e);
            mobileFontReady = true;
        });
    })();

    const loadedImages = {};
    for (const spr in SPRITES) {
        loadedImages[spr] = [];
        for (let i = 0; i < SPRITES[spr].length; i++) {
            const img = new Image();
            img.src = SPRITES[spr][i];
            loadedImages[spr].push(img);
        }
    }

    const state = { cz: 1, cx: 1, cg: 1, cu: 1, cd: 1, cl: 1, cr: 1, mubai: 1, dm: 1 };
    // Teclas Z/X/C travadas na transição 2→3: ficam pressionadas até uiState voltar a 2
    // ou até a tecla física correspondente ser pressionada
    const lockedKeys = { cz: false, cx: false, cg: false };
    const touches = {};
    const physicalKeyStates = {};
    const physicalKeyTimers = {};

    let gameX = 0;
    let gameY = 0;
    let gameScale = 1;
    let dpadActiveTouchId = null;
    // Rastreamento do estado do botão spr_mobile_pad para evitar ativação/desativação contínua
    const mobilePadTouchStates = {};

    let uiState = (function () {
        try {
            const saved = localStorage.getItem('uiState');
            return saved !== null ? parseInt(saved, 10) : 1;
        } catch (e) { return 1; }
    })();
    let mkEnabled = (uiState > 1);

    const globalConfig = {
        mobile_f2: 1,
        mobile_heal: 0,
        mobile_cn: 1,
        Android_System_Keyboard: 0
    };

    const cfgAnalog = {
        zx: 404, zy: 338, xx: 488, xy: 294, cx: 573, cy: 253,
        hx: 556, hy: 5, f2x: 5, f2y: 5,
        analog_posx: -42, analog_posy: 232.5,
        button_scale: 3, analog_scale: 3.5, joystick_type: 0, controls_opacity: 0.5
    };
    const cfgButton = {
        zx: 404, zy: 338, xx: 488, xy: 294, cx: 573, cy: 253,
        hx: 556, hy: 5, f2x: 5, f2y: 5,
        upx: 59, upy: 194, downx: 59, downy: 356, leftx: -22, lefty: 275, rightx: 140, righty: 275,
        button_scale: 3, analog_scale: 3.5, joystick_type: 0, controls_opacity: 0.5
    };

    try {
        const savedAnalog = localStorage.getItem('touchconfig');
        if (savedAnalog) Object.assign(cfgAnalog, JSON.parse(savedAnalog));
        const savedButton = localStorage.getItem('touchconfig_button');
        if (savedButton) Object.assign(cfgButton, JSON.parse(savedButton));
    } catch (e) { }

    let edit = 0;
    let show = 1;
    let touchIndices = [null, null, null, null, null];

    let kb_open = false;

    // ── Adaptador de teclado virtual para TurboWarp ─────────────────────────────
    //
    // Estratégia: um <input> posicionado sobre o canvas do jogo recebe o texto
    // digitado pelo teclado Android. Cada caractere é injetado diretamente no
    // ── Adaptador de teclado virtual para TurboWarp ─────────────────────────────
    //
    // Usa um <input> invisível para capturar digitação do teclado Android.
    // Cada caractere é injetado via ioDevices.keyboard.postData({ key, isDown })
    // que é a API real do scratch-vm: isDown:true adiciona a _keysPressed e emite
    // KEY_PRESSED; isDown:false remove.
    // Letras únicas são convertidas para maiúsculo (padrão Scratch).
    // Teclas especiais (Enter, Backspace) são passadas pelo nome correto.

    const vkbInput = (function () {
        const el = document.createElement('input');
        el.id = 'vkb-input';
        el.type = 'text';
        el.autocomplete = 'off';
        el.autocorrect = 'off';
        el.autocapitalize = 'none';
        el.spellcheck = false;
        el.setAttribute('inputmode', 'none'); // abre só no vkb_show()
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
        el.style.cssText = [
            'position:fixed',
            'left:0', 'top:0',
            'width:100%', 'height:44px',
            'opacity:0',
            'font-size:16px',          // ≥16px evita zoom automático no iOS/Android
            'border:0', 'outline:0',
            'padding:0', 'margin:0',
            'background:transparent',
            'color:transparent',
            'caret-color:transparent',
            'pointer-events:none',
            'z-index:-1'
        ].join(';');
        document.body.appendChild(el);
        return el;
    })();

    // Injeta uma tecla no ioDevices.keyboard do scratch-vm.
    // key: string no formato do scratch-vm ('A', 'space', 'enter', 'Backspace', etc.)
    // O postData espera { key, isDown } — sem isDown a tecla é ignorada.
    function vkbPostKey(key, isDown) {
        const vm = window.vm || (window.scaffolding && window.scaffolding.vm);
        if (!vm || !vm.runtime) return;
        const kb = vm.runtime.ioDevices && vm.runtime.ioDevices.keyboard;
        if (!kb || typeof kb.postData !== 'function') return;
        kb.postData({ key: key, isDown: isDown });
    }

    // Converte um caractere digitado para o formato de chave do scratch-vm
    function vkbCharToKey(char) {
        if (char === ' ') return 'space';
        if (char === '\n' || char === '\r') return 'enter';
        // scratch-vm aceita letras maiúsculas e números
        return char.toUpperCase();
    }

    // Simula press + release de uma tecla (keydown + keyup sintéticos no canvas
    // para compatibilidade com blocos "key X pressed", além do postData)
    function vkbTapKey(key) {
        vkbPostKey(key, true);
        // soltar no próximo frame para dar tempo ao runtime processar
        requestAnimationFrame(function () { vkbPostKey(key, false); });

        // KeyboardEvent no canvas para extensões que escutam eventos DOM
        const canvas = getScratchCanvas();
        if (canvas) {
            const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
            ['keydown', 'keyup'].forEach(function (type) {
                const ev = new KeyboardEvent(type, {
                    key: key, bubbles: true, cancelable: true,
                    keyCode: keyCode, which: keyCode
                });
                Object.defineProperty(ev, 'keyCode', { get: function() { return keyCode; } });
                Object.defineProperty(ev, 'which',   { get: function() { return keyCode; } });
                canvas.dispatchEvent(ev);
            });
        }
    }

    // Escuta input e compositionend (suporte a IME / swipe / autocomplete Android)
    (function () {
        var composing = false;

        vkbInput.addEventListener('compositionstart', function () {
            composing = true;
        });

        vkbInput.addEventListener('compositionend', function () {
            composing = false;
            var val = vkbInput.value;
            for (var i = 0; i < val.length; i++) {
                vkbTapKey(vkbCharToKey(val[i]));
            }
            vkbInput.value = '';
        });

        vkbInput.addEventListener('input', function (e) {
            if (composing || e.isComposing) return;

            var val = vkbInput.value;
            if (val.length === 0) {
                // Backspace apagou o conteúdo
                vkbTapKey('Backspace');
                return;
            }
            for (var i = 0; i < val.length; i++) {
                vkbTapKey(vkbCharToKey(val[i]));
            }
            vkbInput.value = '';
        });

        vkbInput.addEventListener('keydown', function (e) {
            // Captura teclas especiais que não geram evento 'input'
            if (e.key === 'Backspace') { vkbTapKey('Backspace'); return; }
            if (e.key === 'Enter')     { vkbTapKey('enter');     return; }
        });

        vkbInput.addEventListener('blur', function () {
            kb_open = false;
        });

        // Botão voltar Android dispara 'keyup' com key='Escape' no WebView
        document.addEventListener('keyup', function (e) {
            if (kb_open && (e.key === 'Escape' || e.key === 'GoBack')) {
                vkb_hide();
            }
        });

        // Toque fora do teclado fecha o teclado
        document.addEventListener('touchstart', function (e) {
            if (!kb_open) return;
            // Se o toque não foi no vkbInput, fecha
            if (e.target !== vkbInput) {
                vkb_hide();
            }
        }, { passive: true, capture: true });
    })();

    function vkb_show() {
        kb_open = true;
        vkbInput.value = '';
        vkbInput.setAttribute('inputmode', 'text');
        // O Android só abre o teclado se .focus() for chamado dentro de um
        // handler de evento de toque/clique (gesto do usuário).
        // Fazemos isso imediatamente, sem requestAnimationFrame, para não
        // sair do contexto do evento que originou a chamada.
        vkbInput.style.opacity = '0.01';
        vkbInput.style.pointerEvents = 'auto';
        vkbInput.style.zIndex = '999998';
        vkbInput.focus({ preventScroll: true });
        // Volta invisível no próximo frame
        requestAnimationFrame(function () {
            vkbInput.style.opacity = '0';
        });
    }

    function vkb_hide() {
        kb_open = false;
        vkbInput.setAttribute('inputmode', 'none');
        vkbInput.style.opacity = '0';
        vkbInput.style.pointerEvents = 'none';
        vkbInput.style.zIndex = '-1';
        vkbInput.blur();
    }



    let black_fade = 0;
    let text_black_fade = 0;
    let active_key = -1;
    let image_alpha = 1;
    let analog_center_x = 0;
    let analog_center_y = 0;
    let gameIsPaused = false;
    let oldStep = null;

    function saveConfigs() {
        try {
            localStorage.setItem('touchconfig', JSON.stringify(cfgAnalog));
            localStorage.setItem('touchconfig_button', JSON.stringify(cfgButton));
        } catch (e) { }
    }

    let scratchReady = false;


    function applyReadyState() {
        if (scratchReady) return;
        scratchReady = true;
        updateMKVisibility();
    }

    function loadMKState() {
        updateMKVisibility();
    }

    function pollScratchReady() {
        if (scratchReady) return;

        // Lógica:
        // - Se a green flag for apertada DURANTE o loading → ignora (greenFlagDuringLoad)
        // - Quando o loading termina → ativa direto se o projeto já está rodando
        // - Se o projeto não estiver rodando quando o loading termina → espera a próxima green flag

        let greenFlagDuringLoad = false; // green flag apertada antes do loading terminar
        let loadingDone = false;         // loading screen sumiu
        let vmRef = null;

        function isLoadingScreenVisible() {
            const selectors = [
                '[class*="loading"]',
                '[class*="loader"]',
                '[id*="loading"]',
                '[id*="loader"]',
                '.progress',
                '#progress'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                        return true;
                    }
                }
            }
            return false;
        }

        let activatePollRunning = false;

        function tryActivate() {
            if (scratchReady) return;
            if (!loadingDone) return;
            // Se a green flag foi apertada APENAS durante o loading, bloqueia.
            // Precisa de uma green flag nova, ou o projeto já estar rodando.
            const running = vmRef && vmRef.runtime && vmRef.runtime.started;
            if (!running && greenFlagDuringLoad) return;
            const canvas = getScratchCanvas();
            if (!canvas || canvas.getBoundingClientRect().width === 0) {
                if (!activatePollRunning) {
                    activatePollRunning = true;
                    (function poll() {
                        if (scratchReady) return;
                        const c = getScratchCanvas();
                        if (c && c.getBoundingClientRect().width > 0) {
                            activatePollRunning = false;
                            applyReadyState();
                        } else {
                            requestAnimationFrame(poll);
                        }
                    })();
                }
                return;
            }
            applyReadyState();
        }

        function onGreenFlag() {
            if (!loadingDone) {
                greenFlagDuringLoad = true;
            } else {
                // Green flag depois do loading: ativa normalmente
                tryActivate();
            }
        }

        function onLoadingDone() {
            if (loadingDone) return;
            loadingDone = true;
            // Reseta a flag de "green flag durante loading" — a partir daqui
            // o projeto já está rodando (o loading terminou com ele ativo)
            greenFlagDuringLoad = false;
            tryActivate();
        }

        function watchLoadingScreen() {
            if (isLoadingScreenVisible()) {
                const observer = new MutationObserver(function() {
                    if (!isLoadingScreenVisible()) {
                        observer.disconnect();
                        onLoadingDone();
                    }
                });
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['style', 'class']
                });
            } else {
                // Sem loading screen detectável no DOM: considera concluído
                onLoadingDone();
            }
        }

        function waitForVm() {
            if (scratchReady) return;
            const vm = window.vm || (window.scaffolding && window.scaffolding.vm);
            if (vm && vm.runtime) {
                vmRef = vm;
                vm.runtime.on('PROJECT_START', onGreenFlag);
                watchLoadingScreen();
                return;
            }
            requestAnimationFrame(waitForVm);
        }

        waitForVm();
    }

    function saveMKState() {
        try {
            localStorage.setItem('uiState', uiState);
        } catch (e) { }
    }

    function updateMKVisibility() {
        mkEnabled = (uiState > 1);
        if (mkEnabled && scratchReady) {
            mkCanvas.classList.remove('hidden');
            mkCanvas.classList.add('visible');
        } else {
            mkCanvas.classList.remove('visible');
            mkCanvas.classList.add('hidden');
        }
    }

    function getScratchVolume() {
        return 1;
    }

    function playMKSound(key) {
        if (!audioCtx || !audioBuffers[key]) return;
        // Não resume o áudio se o jogo estiver pausado
        if (audioCtx.state === 'suspended' && !gameIsPaused) audioCtx.resume();
        // Não toca o som se estiver pausado
        if (gameIsPaused) return;
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuffers[key];
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = getScratchVolume();
        src.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        src.start(0);
    }

    function toggleMK() {
        const prevUiState = uiState;
        uiState++;
        if (uiState > 4) uiState = 1;

        saveMKState();
        updateMKVisibility();

        if (uiState === 1) playMKSound('disable');
        else if (uiState === 2) playMKSound('enable');
        else if (uiState === 3) playMKSound('snd_mercyadd_mobile');
        else if (uiState === 4) playMKSound('snd_noise_mobile');

        edit = 0;
        active_key = -1;
        black_fade = 0;
        text_black_fade = 0;
        image_alpha = 1;

        // Solta teclas direcionais APENAS ao entrar no modo MK (uiState === 2).
        // Nas transições Joystick ↔ Arrows (3↔4) e para Hidden (1), as direcionais
        // permanecem pressionadas conforme a posição do dedo.
        if (uiState === 2 || uiState === 3) {
            simulateKey(38, 'keyup');
            simulateKey(40, 'keyup');
            simulateKey(37, 'keyup');
            simulateKey(39, 'keyup');
        }

        if (prevUiState === 2 && uiState === 3) {
            // Transição 2→3: trava Z/X/C que estavam pressionados virtualmente.
            // Ficam presos até uiState voltar a 2, ou tecla física ser pressionada.
            lockedKeys.cz = (state.cz < 1);
            lockedKeys.cx = (state.cx < 1);
            lockedKeys.cg = (state.cg < 1);
        } else if (uiState === 2) {
            // Voltou ao MK: libera todas as teclas travadas
            lockedKeys.cz = false;
            lockedKeys.cx = false;
            lockedKeys.cg = false;
        }

        // Ao entrar em qualquer controle, reseta o estado direcional para que
        // o próximo step() detecte como "novo pressionamento" qualquer dedo já posicionado
        state.cu = state.cd = state.cl = state.cr = 1;
    }

    document.addEventListener('keydown', (e) => {
        const kc = e.keyCode;
        physicalKeyStates[kc] = true;

        // Tecla física Z/X/C: libera o travamento da transição 2→3
        if (kc === 90) lockedKeys.cz = false;
        else if (kc === 88) lockedKeys.cx = false;
        else if (kc === 67) lockedKeys.cg = false;

        if (kc === 8) {
            if (e.repeat) return;
            if (scratchReady) {
                toggleMK();
                e.preventDefault();
            }
            return;
        }

        if (kc === 113) {
            if (uiState !== 2) {
                if (e.repeat) return;
            }
            if (window.vm && window.vm.greenFlag) {
                window.vm.greenFlag();
            }
            return;
        }

        if (uiState !== 2) {
            const mkKeys = [90, 88, 67, 38, 40, 37, 39, 72];
            if (mkKeys.includes(kc) && e.repeat) return;
        }

        simulateKey(kc, 'keydown');

        // Start timer loop for MK keys when MK is active (only for physical keys)
        if (mkEnabled && uiState === 2 && e.isTrusted) {
            const mkKeys = [90, 88, 67, 38, 40, 37, 39, 72];
            if (mkKeys.includes(kc) && !physicalKeyTimers[kc]) {
                physicalKeyTimers[kc] = setInterval(() => {
                    simulateKey(kc, 'keyup');
                    setTimeout(() => {
                        if (physicalKeyStates[kc]) {
                            simulateKey(kc, 'keydown');
                        }
                    }, 50);
                }, 30);
            }
        }
    }, true);

    document.addEventListener('keyup', (e) => {
        if (uiState !== 2) {
            if (e.repeat) return;
        }
        const kc = e.keyCode;
        physicalKeyStates[kc] = false;

        // Clear timer for MK keys
        if (physicalKeyTimers[kc]) {
            clearInterval(physicalKeyTimers[kc]);
            delete physicalKeyTimers[kc];
        }

        simulateKey(kc, 'keyup');
    }, true);

    // Converte cor decimal BGR (formato GMS2: $BBGGRR → bits 16-23=B, 8-15=G, 0-7=R) para CSS rgba
    function rgba(bgr, a) {
        const b = (bgr >> 16) & 0xFF;
        const g = (bgr >>  8) & 0xFF;
        const r =  bgr        & 0xFF;
        return `rgba(${r},${g},${b},${a})`;
    }

    function drawRoundRect(x1, y1, x2, y2, color, alpha) {
        const lx = Math.min(x1, x2);
        const rx = Math.max(x1, x2);
        const ty = Math.min(y1, y2);
        const by = Math.max(y1, y2);
        const w = rx - lx;
        const h = by - ty;
        const r = Math.min(6, w / 2, h / 2);

        ctx.save();
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.moveTo(lx + r, ty);
        ctx.lineTo(rx - r, ty);
        ctx.quadraticCurveTo(rx, ty, rx, ty + r);
        ctx.lineTo(rx, by - r);
        ctx.quadraticCurveTo(rx, by, rx - r, by);
        ctx.lineTo(lx + r, by);
        ctx.quadraticCurveTo(lx, by, lx, by - r);
        ctx.lineTo(lx, ty + r);
        ctx.quadraticCurveTo(lx, ty, lx + r, ty);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function pointDirection(dx, dy) {
        let a = Math.atan2(-dy, dx) * 180 / Math.PI;
        return a < 0 ? a + 360 : a;
    }

    function toGUI(touch) {
        if (gameScale === 0) return { x: 0, y: 0 };
        return {
            x: (touch.clientX - gameX) / gameScale,
            y: (touch.clientY - gameY) / gameScale
        };
    }

    let lastSW = 0;
    let lastSH = 0;
    let stableGameX = 0;
    let stableGameY = 0;
    let stableGameScale = 1;
    let hasInitializedBounds = false;
    let resizeTimeout = 0;

    function syncCanvas() {
        const SW = window.innerWidth;
        const SH = window.innerHeight;

        if (SW !== lastSW || SH !== lastSH) {
            resizeTimeout = Date.now() + 500;
            lastSW = SW;
            lastSH = SH;
        }

        if (Date.now() < resizeTimeout || !hasInitializedBounds) {
            const scratchCanvas = getScratchCanvas();
            if (!scratchCanvas) return;

            const c2rect = scratchCanvas.getBoundingClientRect();
            const cw = c2rect.width;
            const ch = c2rect.height;

            if (cw > 0 && ch > 0) {
                const scratchW = (scratchCanvas.width > 0) ? scratchCanvas.width : GAME_W;
                const scratchH = (scratchCanvas.height > 0) ? scratchCanvas.height : GAME_H;

                const scratchSF = Math.min(cw / scratchW, ch / scratchH);
                const scratchDisplayW = scratchW * scratchSF;
                const scratchDisplayH = scratchH * scratchSF;
                const scratchLeft = c2rect.left + (cw - scratchDisplayW) / 2;
                const scratchTop  = c2rect.top  + (ch - scratchDisplayH) / 2;

                const SF = Math.min(scratchDisplayW / GAME_W, scratchDisplayH / GAME_H);

                stableGameX = scratchLeft + (scratchDisplayW - GAME_W * SF) / 2;
                stableGameY = scratchTop  + (scratchDisplayH - GAME_H * SF) / 2;
                stableGameScale = SF;
                hasInitializedBounds = true;

                const DPR = window.devicePixelRatio || 1;
                mkCanvas.width = SW * DPR;
                mkCanvas.height = SH * DPR;
                mkCanvas.style.left = "0px";
                mkCanvas.style.top = "0px";
                mkCanvas.style.width = SW + "px";
                mkCanvas.style.height = SH + "px";
                mkCanvas.style.transform = "none";
            }
        }

        gameX = stableGameX;
        gameY = stableGameY;
        gameScale = stableGameScale;
    }

    function drawSprite(sprName, subimg, x, y, scaleX, scaleY, alpha) {
        if (!loadedImages[sprName] || !loadedImages[sprName][subimg]) return;
        const img = loadedImages[sprName][subimg];
        if (!img.complete || !img.naturalWidth) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, img.naturalWidth * scaleX, img.naturalHeight * scaleY);
        ctx.restore();
    }

    function fmtNum(n, decimals) {
        const r = Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
        return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(Math.max(2, decimals));
    }

    function drawTextNumber(x, y, num, alpha) {
        const str = String(num);
        ctx.save();
        ctx.globalAlpha = alpha;
        const fontFamily = mobileFontReady ? MOBILE_FONT_NAME : 'monospace';
        ctx.font = '25px ' + fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        ctx.fillText(str, x, y);
        ctx.restore();
    }

    function isPointInRect(px, py, rx, ry, rw, rh) {
        return px >= rx && py >= ry && px <= rx + rw && py <= ry + rh;
    }

    function handleEditModeInput() {
        if (edit === 0) return;

        let clicked = false;
        let mx = 0, my = 0;
        if (touches['mouse']) {
            mx = touches['mouse'].x;
            my = touches['mouse'].y;
            if (touches['mouse'].pressed) {
                clicked = true;
                touches['mouse'].pressed = false;
            }
        }
        for (let id in touches) {
            if (id !== 'mouse' && touches[id].pressed) {
                mx = touches[id].x;
                my = touches[id].y;
                clicked = true;
                touches[id].pressed = false;
                break;
            }
        }

        if (clicked) {
            let cfg = uiState === 3 ? cfgAnalog : cfgButton;

            if (active_key === -1 && isPointInSprite(mx, my, cfg.zx, cfg.zy, 'spr_z_button', cfg.button_scale)) { active_key = 125; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && isPointInSprite(mx, my, cfg.xx, cfg.xy, 'spr_x_button', cfg.button_scale)) { active_key = 124; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && isPointInSprite(mx, my, cfg.cx, cfg.cy, 'spr_c_button', cfg.button_scale)) { active_key = 94; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && globalConfig.mobile_f2 && isPointInSprite(mx, my, cfg.f2x, cfg.f2y, 'spr_button_restart', cfg.button_scale)) { active_key = 101; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && globalConfig.mobile_heal && isPointInSprite(mx, my, cfg.hx, cfg.hy, 'spr_h_button', cfg.button_scale)) { active_key = 96; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && uiState === 3 && isPointInSprite(mx, my, cfg.analog_posx, cfg.analog_posy, 'spr_joybase', cfg.analog_scale)) { active_key = 93; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && uiState === 4 && isPointInSprite(mx, my, cfg.upx, cfg.upy, 'spr_button_up', cfg.analog_scale)) { active_key = 97; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && uiState === 4 && isPointInSprite(mx, my, cfg.downx, cfg.downy, 'spr_button_down', cfg.analog_scale)) { active_key = 98; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && uiState === 4 && isPointInSprite(mx, my, cfg.leftx, cfg.lefty, 'spr_button_left', cfg.analog_scale)) { active_key = 99; playMKSound('snd_noise_mobile'); }
            else if (active_key === -1 && uiState === 4 && isPointInSprite(mx, my, cfg.rightx, cfg.righty, 'spr_button_right', cfg.analog_scale)) { active_key = 100; playMKSound('snd_noise_mobile'); }
            else if (isPointInRect(mx, my, 440.5, 75, 29, 18)) {
                if (cfg.button_scale > 1) { cfg.button_scale -= 0.1; playMKSound('snd_equip_mobile'); } else playMKSound('snd_hurt_mobile');
            } else if (isPointInRect(mx, my, 531.5, 75, 30, 18)) {
                cfg.button_scale += 0.1; playMKSound('snd_coin_mobile');
            } else if (isPointInRect(mx, my, 440.5, 121, 29, 18)) {
                if (cfg.analog_scale > 1) { cfg.analog_scale -= 0.1; playMKSound('snd_equip_mobile'); } else playMKSound('snd_hurt_mobile');
            } else if (isPointInRect(mx, my, 531.5, 121, 30, 18)) {
                cfg.analog_scale += 0.1; playMKSound('snd_coin_mobile');
            } else if (isPointInRect(mx, my, 440.5, 167, 29, 18)) {
                if (uiState === 3) {
                    if (cfg.joystick_type == 1) { cfg.joystick_type = 0; playMKSound('snd_equip_mobile'); } else playMKSound('snd_hurt_mobile');
                } else {
                    if (cfg.controls_opacity > 0.1) { cfg.controls_opacity -= 0.05; playMKSound('snd_equip_mobile'); } else playMKSound('snd_hurt_mobile');
                }
            } else if (isPointInRect(mx, my, 531.5, 167, 30, 18)) {
                if (uiState === 3) {
                    if (cfg.joystick_type == 0) { cfg.joystick_type = 1; playMKSound('snd_coin_mobile'); } else playMKSound('snd_hurt_mobile');
                } else {
                    if (cfg.controls_opacity < 1) { cfg.controls_opacity += 0.05; playMKSound('snd_coin_mobile'); } else playMKSound('snd_hurt_mobile');
                }
            } else if (uiState === 3 && isPointInRect(mx, my, 440.5, 213, 29, 18)) {
                if (cfg.controls_opacity > 0.1) { cfg.controls_opacity -= 0.05; playMKSound('snd_equip_mobile'); } else playMKSound('snd_hurt_mobile');
            } else if (uiState === 3 && isPointInRect(mx, my, 531.5, 213, 30, 18)) {
                if (cfg.controls_opacity < 1) { cfg.controls_opacity += 0.05; playMKSound('snd_coin_mobile'); } else playMKSound('snd_hurt_mobile');
            } else if (isPointInRect(mx, my, 241, 412.25, 158, 24)) {
                playMKSound('snd_noise_mobile');
                if (uiState === 3) {
                    Object.assign(cfgAnalog, { zx: 404, zy: 338, xx: 488, xy: 294, cx: 573, cy: 253, hx: 556, hy: 5, f2x: 5, f2y: 5, analog_posx: -42, analog_posy: 232.5, button_scale: 3, analog_scale: 3.5, joystick_type: 0, controls_opacity: 0.5 });
                } else {
                    Object.assign(cfgButton, { zx: 404, zy: 338, xx: 488, xy: 294, cx: 573, cy: 253, hx: 556, hy: 5, f2x: 5, f2y: 5, upx: 59, upy: 194, downx: 59, downy: 356, leftx: -22, lefty: 275, rightx: 140, righty: 275, button_scale: 3, analog_scale: 3.5, joystick_type: 0, controls_opacity: 0.5 });
                }
            }
        }

        if (active_key !== -1) {
            if (Object.keys(touches).length > 0) {
                let tmx = 0, tmy = 0, hasT = false;
                if (touches['mouse']) { tmx = touches['mouse'].x; tmy = touches['mouse'].y; hasT = true; }
                else { for (let id in touches) { tmx = touches[id].x; tmy = touches[id].y; hasT = true; break; } }

                if (hasT) {
                    let cfg = uiState === 3 ? cfgAnalog : cfgButton;
                    if (active_key === 125) { cfg.zx = tmx - (13.5 * cfg.button_scale); cfg.zy = tmy - (12.5 * cfg.button_scale); }
                    if (active_key === 124) { cfg.xx = tmx - (13.5 * cfg.button_scale); cfg.xy = tmy - (12.5 * cfg.button_scale); }
                    if (active_key === 94) { cfg.cx = tmx - (13.5 * cfg.button_scale); cfg.cy = tmy - (12.5 * cfg.button_scale); }
                    if (active_key === 96) { cfg.hx = tmx - (13.5 * cfg.button_scale); cfg.hy = tmy - (12.5 * cfg.button_scale); }
                    if (active_key === 101) { cfg.f2x = tmx - (13.5 * cfg.button_scale); cfg.f2y = tmy - (12.5 * cfg.button_scale); }

                    if (uiState === 3) {
                        if (active_key === 93) { cfg.analog_posx = tmx - (29.5 * cfg.analog_scale); cfg.analog_posy = tmy - (29.5 * cfg.analog_scale); }
                    } else {
                        if (active_key === 97) { cfg.upx = tmx - (13.5 * cfg.analog_scale); cfg.upy = tmy - (12.5 * cfg.analog_scale); }
                        if (active_key === 98) { cfg.downx = tmx - (13.5 * cfg.analog_scale); cfg.downy = tmy - (12.5 * cfg.analog_scale); }
                        if (active_key === 99) { cfg.leftx = tmx - (13.5 * cfg.analog_scale); cfg.lefty = tmy - (12.5 * cfg.analog_scale); }
                        if (active_key === 100) { cfg.rightx = tmx - (13.5 * cfg.analog_scale); cfg.righty = tmy - (12.5 * cfg.analog_scale); }
                    }
                }
            } else {
                playMKSound('snd_menu_confirm_mobile');
                active_key = -1;
            }
        }

        if (edit !== 0 && uiState === 3) {
            analog_center_x = cfgAnalog.analog_posx + (((59 * cfgAnalog.analog_scale) / 2) - ((41 * cfgAnalog.analog_scale) / 2));
            analog_center_y = cfgAnalog.analog_posy + (((59 * cfgAnalog.analog_scale) / 2) - ((41 * cfgAnalog.analog_scale) / 2));
        }
    }

    document.addEventListener('keydown', (e) => {
        if (!controlsAcceptInput() || edit === 0) return;
        const kc = e.keyCode;
        if (kc === 220) {
            edit += 1;
            if (edit === 1) {
                show = 1;
                playMKSound('enable');
            } else if (edit === 3) {
                playMKSound('enable');
                saveConfigs();
                edit = 0;
            }
        }
        if (active_key === -1 && edit !== 0) {

            if (kc === 90) { active_key = 125; playMKSound('snd_noise_mobile'); }
            else if (kc === 88) { active_key = 124; playMKSound('snd_noise_mobile'); }
            else if (kc === 67) { active_key = 94; playMKSound('snd_noise_mobile'); }
            else if (kc === 72) { active_key = 96; playMKSound('snd_noise_mobile'); }
            else if (kc === 113) { active_key = 101; playMKSound('snd_noise_mobile'); }
            else if (uiState === 3 && kc === 16) { active_key = 93; playMKSound('snd_noise_mobile'); }
            else if (uiState === 4) {
                if (kc === 38) { active_key = 97; playMKSound('snd_noise_mobile'); }
                if (kc === 40) { active_key = 98; playMKSound('snd_noise_mobile'); }
                if (kc === 37) { active_key = 99; playMKSound('snd_noise_mobile'); }
                if (kc === 39) { active_key = 100; playMKSound('snd_noise_mobile'); }
            }
        }
    });
    document.addEventListener('keyup', (e) => {
        if (!controlsAcceptInput() || edit === 0) return;
        if (active_key !== -1) {

            let match = false;
            const kc = e.keyCode;
            if (kc === 90 && active_key === 125) match = true;
            if (kc === 88 && active_key === 124) match = true;
            if (kc === 67 && active_key === 94) match = true;
            if (kc === 72 && active_key === 96) match = true;
            if (kc === 113 && active_key === 101) match = true;
            if (uiState === 3 && kc === 16 && active_key === 93) match = true;
            if (uiState === 4) {
                if (kc === 38 && active_key === 97) match = true;
                if (kc === 40 && active_key === 98) match = true;
                if (kc === 37 && active_key === 99) match = true;
                if (kc === 39 && active_key === 100) match = true;
            }
            if (match) {
                playMKSound('snd_menu_confirm_mobile');
                active_key = -1;
            }
        }
    });

    function isPointInSprite(px, py, sx, sy, sprName, scale) {
        if (!loadedImages[sprName]) return false;
        const img = loadedImages[sprName][0];
        if (!img) return false;
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        return px >= sx && py >= sy && px <= sx + w && py <= sy + h;
    }

    function controlsAcceptInput() {
        return scratchReady;
    }

    function isPointOnSettingsButton(gx, gy) {
        return isPointInSprite(gx, gy, -50, 5, 'spr_settings_mobile', 2);
    }

    function activateSettingsButton() {
        if (edit === 0) {
            edit = 1;
            show = 1;
            playMKSound('snd_spearappear_mobile');
        } else {
            playMKSound('snd_egg_mobile');
            saveConfigs();
            edit = 0;
        }
    }

    function trySettingsButtonActivation(t, gx, gy) {
        if (uiState !== 3 && uiState !== 4) return;
        const onSettings = isPointOnSettingsButton(gx, gy);
        // Ativa ao ENTRAR na região do botão: toque direto ou arraste de qualquer lugar.
        // prevOnSettings só vira true, nunca volta a false durante o toque (evita
        // dupla ativação quando o dedo oscila na borda ao arrastar horizontalmente).
        if (onSettings && !t.prevOnSettings) {
            activateSettingsButton();
            t.prevOnSettings = true;
        }
    }

    function isTouchOnControl(gx, gy) {
        if (!scratchReady) return false;
        if (isPointOnSettingsButton(gx, gy)) return true;
        let cfg = uiState === 3 ? cfgAnalog : cfgButton;
        if (globalConfig.mobile_heal && isPointInSprite(gx, gy, cfg.hx, cfg.hy, 'spr_h_button', cfg.button_scale)) return true;
        if (globalConfig.mobile_f2 && isPointInSprite(gx, gy, cfg.f2x, cfg.f2y, 'spr_button_restart', cfg.button_scale)) return true;
        if (isPointInSprite(gx, gy, cfg.zx, cfg.zy, 'spr_z_button', cfg.button_scale)) return true;
        if (isPointInSprite(gx, gy, cfg.xx, cfg.xy, 'spr_x_button', cfg.button_scale)) return true;
        if (isPointInSprite(gx, gy, cfg.cx, cfg.cy, 'spr_c_button', cfg.button_scale)) return true;

        if (uiState === 3) {
            const s = cfg.analog_scale;
            const posx = cfg.analog_posx;
            const posy = cfg.analog_posy;
            const back = 45 * s;
            const full = 59 * s;
            if (gx >= posx - back && gx <= posx + full + back && gy >= posy - back && gy <= posy + full + back) return true;
        } else if (uiState === 4) {
            if (isPointInSprite(gx, gy, cfg.upx, cfg.upy, 'spr_button_up', cfg.analog_scale)) return true;
            if (isPointInSprite(gx, gy, cfg.downx, cfg.downy, 'spr_button_down', cfg.analog_scale)) return true;
            if (isPointInSprite(gx, gy, cfg.leftx, cfg.lefty, 'spr_button_left', cfg.analog_scale)) return true;
            if (isPointInSprite(gx, gy, cfg.rightx, gy, 'spr_button_right', cfg.analog_scale)) return true;
        }
        return false;
    }

    function isPointInCircle(px, py, cx, cy, r) {
        return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
    }

    function keyboardCheck(kc, prevStates) {
        if (kc === 90) return prevStates.cz < 1;
        if (kc === 88) return prevStates.cx < 1;
        if (kc === 67) return prevStates.cg < 1;
        if (kc === 38) return prevStates.cu < 1;
        if (kc === 40) return prevStates.cd < 1;
        if (kc === 37) return prevStates.cl < 1;
        if (kc === 39) return prevStates.cr < 1;
        if (kc === 72) return prevStates.dm < 1;
        if (kc === 113) return prevStates.f2 < 1;
        return false;
    }

    function step() {
        if (!controlsAcceptInput()) return;
        syncCanvas();
        const oldState = Object.assign({}, state);
        state.cz = state.cx = state.cg = state.cu = state.cd = state.cl = state.cr = state.mubai = state.dm = state.settings = state.kb = state.f2 = state.an = 1;

        // Teclas travadas na transição 2→3: forçar pressionadas até uiState voltar a 2
        // ou tecla física correspondente ser pressionada
        if (lockedKeys.cz) state.cz = 0.5;
        if (lockedKeys.cx) state.cx = 0.5;
        if (lockedKeys.cg) state.cg = 0.5;

        if (uiState === 3 || uiState === 4) {
            for (const id in touches) {
                if (!touches.hasOwnProperty(id)) continue;
                const t = touches[id];
                if (isPointOnSettingsButton(t.x, t.y)) state.settings = 0.5;
            }
        }

        if (uiState === 2) {

            let _m = 0;
            for (const id in touches) {
                if (!touches.hasOwnProperty(id)) continue;
                const t = touches[id];
                const gx = t.x, gy = t.y;
                let _ak = 0, _ak2 = 0;

                if (globalConfig.mobile_heal ? (gx >= 560 && gx <= 640 && gy >= 51) : gx >= 560) { state.cz = 0.5; _ak = 90; }
                else if (globalConfig.mobile_heal && gx > 640) { state.cz = 0.5; _ak = 90; }
                else if (gx >= 480 && gx < 560) { state.cx = 0.5; _ak = 88; }
                else if (gx >= 400 && gx < 480) { state.cg = 0.5; _ak = 67; }
                else if (gx >= 560 && gx <= 640 && gy <= 50) { state.dm = 0.5; _ak = 72; }
                else if (globalConfig.mobile_f2 && gx <= 80 && gx >= 0 && gy <= 50) { state.f2 = 0.5; _ak = 113; }
                else if (!_m) {
                    if (gx < 400) {
                        _m = 1;
                        const _dx = gx - 140;
                        const _dy = gy - 360;
                        const _da = pointDirection(_dx, _dy);

                        if (_da >= 292.5 || _da <= 67.5) {
                            state.cr = 0.5;
                            if (_ak === 0) _ak = 39; else _ak2 = 39;
                        }
                        if (_da >= 22.5 && _da <= 157.5) {
                            state.cu = 0.5;
                            if (_ak === 0) _ak = 38; else _ak2 = 38;
                        }
                        if (_da >= 112.5 && _da <= 247.5) {
                            state.cl = 0.5;
                            if (_ak === 0) _ak = 37; else _ak2 = 37;
                        }
                        if (_da >= 202.5 && _da <= 337.5) {
                            state.cd = 0.5;
                            if (_ak === 0) _ak = 40; else _ak2 = 40;
                        }
                    }
                }

                if (t.pressed) {
                    if (_ak !== 0 && keyboardCheck(_ak, oldState)) { simulateKey(_ak, 'keyup'); simulateKey(_ak, 'keydown'); }
                    if (_ak2 !== 0 && keyboardCheck(_ak2, oldState)) { simulateKey(_ak2, 'keyup'); simulateKey(_ak2, 'keydown'); }
                    t.pressed = false;
                }
            }

            if (state.f2 === 0.5 && !keyboardCheck(113, oldState)) simulateKey(113, 'keydown');
            if (state.dm === 0.5 && !keyboardCheck(72, oldState)) simulateKey(72, 'keydown');
            if (state.cz === 0.5 && !keyboardCheck(90, oldState)) simulateKey(90, 'keydown');
            if (state.cx === 0.5 && !keyboardCheck(88, oldState)) simulateKey(88, 'keydown');
            if (state.cg === 0.5 && !keyboardCheck(67, oldState)) simulateKey(67, 'keydown');
            if (state.cr === 0.5 && !keyboardCheck(39, oldState)) simulateKey(39, 'keydown');
            if (state.cu === 0.5 && !keyboardCheck(38, oldState)) simulateKey(38, 'keydown');
            if (state.cl === 0.5 && !keyboardCheck(37, oldState)) simulateKey(37, 'keydown');
            if (state.cd === 0.5 && !keyboardCheck(40, oldState)) simulateKey(40, 'keydown');

            if (state.f2 === 1 && keyboardCheck(113, oldState)) simulateKey(113, 'keyup');
            if (state.dm === 1 && keyboardCheck(72, oldState)) simulateKey(72, 'keyup');
            if (state.cz === 1 && keyboardCheck(90, oldState)) simulateKey(90, 'keyup');
            if (state.cx === 1 && keyboardCheck(88, oldState)) simulateKey(88, 'keyup');
            if (state.cg === 1 && keyboardCheck(67, oldState)) simulateKey(67, 'keyup');
            if (state.cr === 1 && keyboardCheck(39, oldState)) simulateKey(39, 'keyup');
            if (state.cu === 1 && keyboardCheck(38, oldState)) simulateKey(38, 'keyup');
            if (state.cl === 1 && keyboardCheck(37, oldState)) simulateKey(37, 'keyup');
            if (state.cd === 1 && keyboardCheck(40, oldState)) simulateKey(40, 'keyup');
        } else if (uiState === 3 || uiState === 4) {

            let cfg = uiState === 3 ? cfgAnalog : cfgButton;

            image_alpha = (show === 1) ? Math.min(image_alpha + 0.1, 1) : Math.max(image_alpha - 0.1, 0);
            black_fade = (edit === 0) ? Math.max(black_fade - 0.04, 0) : Math.min(black_fade + 0.04, 0.4);
            text_black_fade = (edit === 0) ? Math.max(text_black_fade - 0.09, 0) : Math.min(text_black_fade + 0.09, 0.9);

            if (edit === 0) {
                let _m = 0;
                for (const id in touches) {
                    if (!touches.hasOwnProperty(id)) continue;
                    const t = touches[id];
                    const gx = t.x, gy = t.y;
                    let _ak = 0, _ak2 = 0;

                    if (globalConfig.Android_System_Keyboard && isPointInSprite(gx, gy, 652, 5, 'spr_mobile_pad', 2)) {
                        state.kb = 0.5;
                        // vkb_show/hide é chamado no touchstart (handler de gesto),
                        // não aqui no rAF loop — o Android bloqueia .focus() fora de gestos.
                    }

                    if (globalConfig.mobile_heal && isPointInSprite(gx, gy, cfg.hx, cfg.hy, 'spr_h_button', cfg.button_scale)) { state.dm = 0.5; _ak = 72; }
                    if (globalConfig.mobile_f2 && isPointInSprite(gx, gy, cfg.f2x, cfg.f2y, 'spr_button_restart', cfg.button_scale)) { state.f2 = 0.5; _ak = 113; }
                    if (isPointInSprite(gx, gy, cfg.zx, cfg.zy, 'spr_z_button', cfg.button_scale)) { state.cz = 0.5; _ak = 90; }
                    if (isPointInSprite(gx, gy, cfg.xx, cfg.xy, 'spr_x_button', cfg.button_scale)) { state.cx = 0.5; _ak = 88; }
                    if (isPointInSprite(gx, gy, cfg.cx, cfg.cy, 'spr_c_button', cfg.button_scale)) { state.cg = 0.5; _ak = 67; }

                    if (uiState === 3) {
                        const s = cfg.analog_scale;
                        const posx = cfg.analog_posx;
                        const posy = cfg.analog_posy;
                        const back = 45 * s;
                        const area = 19.675 * s;
                        const full = 59 * s;

                        const in126 = (gx >= posx - back && gx <= posx + full + back && gy >= posy - back && gy <= posy + full + back);
                        if (in126) state.an = 0.5;

                        if (gx >= posx - back && gx <= posx + full + back && gy >= posy - back && gy <= posy + area) {
                            state.cu = 0.5; if (_ak === 0) _ak = 38; else _ak2 = 38;
                        }
                        if (gx >= posx - back && gx <= posx + full + back && gy >= posy + full - area && gy <= posy + full + back) {
                            state.cd = 0.5; if (_ak === 0) _ak = 40; else _ak2 = 40;
                        }
                        if (gx >= posx - back && gx <= posx + area && gy >= posy - back && gy <= posy + full + back) {
                            state.cl = 0.5; if (_ak === 0) _ak = 37; else _ak2 = 37;
                        }
                        if (gx >= posx + full - area && gx <= posx + full + back && gy >= posy - back && gy <= posy + full + back) {
                            state.cr = 0.5; if (_ak === 0) _ak = 39; else _ak2 = 39;
                        }
                    } else {
                        if (isPointInSprite(gx, gy, cfg.upx, cfg.upy, 'spr_button_up', cfg.analog_scale)) { state.cu = 0.5; _ak = 38; }
                        if (isPointInSprite(gx, gy, cfg.downx, cfg.downy, 'spr_button_down', cfg.analog_scale)) { state.cd = 0.5; _ak = 40; }
                        if (isPointInSprite(gx, gy, cfg.leftx, cfg.lefty, 'spr_button_left', cfg.analog_scale)) { state.cl = 0.5; _ak = 37; }
                        if (isPointInSprite(gx, gy, cfg.rightx, cfg.righty, 'spr_button_right', cfg.analog_scale)) { state.cr = 0.5; _ak = 39; }
                    }

                    if (t.pressed) {
                        if (_ak !== 0 && keyboardCheck(_ak, oldState)) { simulateKey(_ak, 'keyup'); simulateKey(_ak, 'keydown'); }
                        if (_ak2 !== 0 && keyboardCheck(_ak2, oldState)) { simulateKey(_ak2, 'keyup'); simulateKey(_ak2, 'keydown'); }
                        t.pressed = false;
                    }
                }

                if (uiState === 3) {

                    if (state.an < 1) {
                        let gx0 = device_mouse_x_to_gui(0);
                        let gy0 = device_mouse_y_to_gui(0);
                        if (gx0 >= cfg.analog_posx && gx0 <= (cfg.analog_posx + (59 * cfg.analog_scale)))
                            analog_center_x = gx0 - (21 * cfg.analog_scale);
                        if (gy0 >= cfg.analog_posy && gy0 <= (cfg.analog_posy + (59 * cfg.analog_scale)))
                            analog_center_y = gy0 - (21 * cfg.analog_scale);
                    } else {
                        analog_center_x = cfg.analog_posx + (((59 * cfg.analog_scale) / 2) - ((41 * cfg.analog_scale) / 2));
                        analog_center_y = cfg.analog_posy + (((59 * cfg.analog_scale) / 2) - ((41 * cfg.analog_scale) / 2));
                    }
                }
            } else {
                handleEditModeInput();
            }
        }

        if (uiState !== 2) {
            if (state.f2 !== oldState.f2) simulateKey(113, state.f2 < 1 ? 'keydown' : 'keyup');
            if (state.dm !== oldState.dm) simulateKey(72, state.dm < 1 ? 'keydown' : 'keyup');
            if (state.cu !== oldState.cu) simulateKey(38, state.cu < 1 ? 'keydown' : 'keyup');
            if (state.cd !== oldState.cd) simulateKey(40, state.cd < 1 ? 'keydown' : 'keyup');
            if (state.cl !== oldState.cl) simulateKey(37, state.cl < 1 ? 'keydown' : 'keyup');
            if (state.cr !== oldState.cr) simulateKey(39, state.cr < 1 ? 'keydown' : 'keyup');
            if (state.cg !== oldState.cg) simulateKey(67, state.cg < 1 ? 'keydown' : 'keyup');
            if (state.cx !== oldState.cx) simulateKey(88, state.cx < 1 ? 'keydown' : 'keyup');
            if (state.cz !== oldState.cz) simulateKey(90, state.cz < 1 ? 'keydown' : 'keyup');
            if (state.an !== oldState.an) simulateKey(126, state.an < 1 ? 'keydown' : 'keyup');
        }
    }

    function device_mouse_x_to_gui(n) {
        let id = touchIndices[n];
        if (id !== null && touches[id]) return touches[id].x;
        if (n === 0 && touches['mouse']) return touches['mouse'].x;
        return -1000;
    }

    function device_mouse_y_to_gui(n) {
        let id = touchIndices[n];
        if (id !== null && touches[id]) return touches[id].y;
        if (n === 0 && touches['mouse']) return touches['mouse'].y;
        return -1000;
    }

    function simulateKey(keyCode, type) {
        let keyStr = "";
        if (keyCode === 38) keyStr = "ArrowUp";
        else if (keyCode === 40) keyStr = "ArrowDown";
        else if (keyCode === 37) keyStr = "ArrowLeft";
        else if (keyCode === 39) keyStr = "ArrowRight";
        else if (keyCode === 90) keyStr = "z";
        else if (keyCode === 88) keyStr = "x";
        else if (keyCode === 67) keyStr = "c";
        else if (keyCode === 72) keyStr = "h";
        else if (keyCode === 113) keyStr = "F2";
        else if (keyCode === 8) keyStr = "Backspace";

        const event = new KeyboardEvent(type, {
            keyCode: keyCode,
            which: keyCode,
            key: keyStr,
            bubbles: true,
            cancelable: true
        });
        Object.defineProperty(event, 'keyCode', { get: () => keyCode });
        Object.defineProperty(event, 'which', { get: () => keyCode });

        document.dispatchEvent(event);
    }

    function drawMK() {
        if (!mkEnabled) return;
        ctx.clearRect(0, 0, mkCanvas.width, mkCanvas.height);
        ctx.save();
        const _dpr = window.devicePixelRatio || 1;
        ctx.translate(gameX * _dpr, gameY * _dpr);
        ctx.scale(gameScale * _dpr, gameScale * _dpr);

        if (uiState === 2) {

            if (globalConfig.mobile_f2 === 1) drawRoundRect(0, 0, 80, 30, C_WHITE, BTN_ALPHA);
            if (globalConfig.mobile_heal === 1) drawRoundRect(560, 0, 640, 30, C_WHITE, BTN_ALPHA);
            drawRoundRect(400, 460, 480, 480, C_GREEN, BTN_ALPHA);
            drawRoundRect(480, 420, 560, 460, C_ORANGE, BTN_ALPHA);
            drawRoundRect(560, 420, 640, 460, C_AQUA, BTN_ALPHA);

            if (loadedImages['spr_mobilekey'] && loadedImages['spr_mobilekey'][0]) {
                const spr = loadedImages['spr_mobilekey'][0];
                if (spr.complete && spr.naturalWidth) {
                    ctx.globalAlpha = 0.41;
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(spr, 76, 296, spr.naturalWidth * 2, spr.naturalHeight * 2);
                    ctx.globalAlpha = 1.0;
                }
            }
        } else if (uiState === 3 || uiState === 4) {
            let cfg = uiState === 3 ? cfgAnalog : cfgButton;

            drawSprite('spr_black_mobile', 0, 0, 0, 1, 1, black_fade);

            let cn = globalConfig.mobile_cn;
            drawSprite('spr_arrow_leftright_mobile', 0, 459.5, 75, 2, 2, text_black_fade);
            drawSprite('spr_arrow_leftright_mobile', 0, 459.5, 121, 2, 2, text_black_fade);
            drawSprite('spr_arrow_leftright_mobile', 0, 459.5, 167, 2, 2, text_black_fade);
            if (uiState === 3) drawSprite('spr_arrow_leftright_mobile', 0, 459.5, 213, 2, 2, text_black_fade);

            drawSprite('spr_button_scale', cn, 120.5, 75, 2, 2, text_black_fade);
            drawSprite('spr_analog_scale', cn, 120.5, 121, 2, 2, text_black_fade);
            if (uiState === 3) {
                drawSprite('spr_analog_type', cn, 124, 167, 2, 2, text_black_fade);
                drawSprite('spr_controls_opacity', cn, 106.5, 213, 2, 2, text_black_fade);
            } else {
                drawSprite('spr_controls_opacity', cn, 106.5, 167, 2, 2, text_black_fade);
            }

            drawSprite('spr_controls_config', cn, 220, 22.5, 2, 2, text_black_fade);
            drawSprite('spr_reset_config', cn, 241, 412.25, 2, 2, text_black_fade);

            if (edit === 2 || edit === 1 || (edit === 0 && black_fade > 0)) {
                drawTextNumber(503, 73.5, fmtNum(cfg.button_scale, 1), text_black_fade);
                drawTextNumber(503, 119.5, fmtNum(cfg.analog_scale, 1), text_black_fade);
                if (uiState === 3) {
                    drawTextNumber(503, 165.5, cfg.joystick_type, text_black_fade);
                    drawTextNumber(503, 211.5, fmtNum(cfg.controls_opacity, 2), text_black_fade);
                } else {
                    drawTextNumber(503, 165.5, fmtNum(cfg.controls_opacity, 2), text_black_fade);
                }
            }

            const op = (cfg.controls_opacity * image_alpha);
            drawSprite('spr_z_button', (state.cz < 1 || physicalKeyStates[90]) ? 1 : 0, cfg.zx, cfg.zy, cfg.button_scale, cfg.button_scale, op);
            drawSprite('spr_x_button', (state.cx < 1 || physicalKeyStates[88]) ? 1 : 0, cfg.xx, cfg.xy, cfg.button_scale, cfg.button_scale, op);
            drawSprite('spr_c_button', (state.cg < 1 || physicalKeyStates[67]) ? 1 : 0, cfg.cx, cfg.cy, cfg.button_scale, cfg.button_scale, op);

            if (globalConfig.mobile_f2) drawSprite('spr_button_restart', (state.f2 < 1 || physicalKeyStates[113]) ? 1 : 0, cfg.f2x, cfg.f2y, cfg.button_scale, cfg.button_scale, op);
            if (globalConfig.mobile_heal) drawSprite('spr_h_button', (state.dm < 1 || physicalKeyStates[72]) ? 1 : 0, cfg.hx, cfg.hy, cfg.button_scale, cfg.button_scale, op);
            if (globalConfig.Android_System_Keyboard) drawSprite('spr_mobile_pad', (state.kb < 1 || physicalKeyStates[118]) ? 1 : 0, 652, 5, 2, 2, 0.5);

            if (uiState === 3) {
                drawSprite('spr_joybase', cfg.joystick_type, cfg.analog_posx, cfg.analog_posy, cfg.analog_scale, cfg.analog_scale, op);
                drawSprite('spr_joystick', cfg.joystick_type, analog_center_x, analog_center_y, cfg.analog_scale, cfg.analog_scale, op);
            } else {
                drawSprite('spr_button_left', (state.cl < 1 || physicalKeyStates[37]) ? 1 : 0, cfg.leftx, cfg.lefty, cfg.analog_scale, cfg.analog_scale, op);
                drawSprite('spr_button_up', (state.cu < 1 || physicalKeyStates[38]) ? 1 : 0, cfg.upx, cfg.upy, cfg.analog_scale, cfg.analog_scale, op);
                drawSprite('spr_button_right', (state.cr < 1 || physicalKeyStates[39]) ? 1 : 0, cfg.rightx, cfg.righty, cfg.analog_scale, cfg.analog_scale, op);
                drawSprite('spr_button_down', (state.cd < 1 || physicalKeyStates[40]) ? 1 : 0, cfg.downx, cfg.downy, cfg.analog_scale, cfg.analog_scale, op);
            }

            drawSprite('spr_settings_mobile', state.settings < 1 ? 1 : 0, -50, 5, 2, 2, 0.5);
        }
        ctx.restore();
    }

    let lastMkError = "";
    function loop() {
        try {
            step();
            drawMK();
            lastMkError = "";
        } catch (e) {
            console.error("MK Loop Error:", e);
            lastMkError = e.message;
        }
        if (lastMkError) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = 'red';
            ctx.font = '16px Arial';
            ctx.fillText("MK Error: " + lastMkError, 10, 50);
            ctx.restore();
        }
        requestAnimationFrame(loop);
    }

    window.addEventListener('load', tryAutoInitAudio, { once: true });
    document.addEventListener('click', tryAutoInitAudio, { once: true });
    document.addEventListener('keydown', tryAutoInitAudio, { once: true });
    document.addEventListener('pointerdown', tryAutoInitAudio, { once: true });
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) tryAutoInitAudio();
    });
    setTimeout(tryAutoInitAudio, 0);
    setTimeout(tryAutoInitAudio, 500);

    document.addEventListener('touchstart', e => {
        initAudio();
        if (!controlsAcceptInput()) return;

        let consumed = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const guiPos = toGUI(t);
            if (edit !== 0 || isTouchOnControl(guiPos.x, guiPos.y)) {
                consumed = true;
            }

            // Botão do teclado Android — precisa ser aqui (contexto de gesto)
            // para que .focus() abra o teclado do sistema.
            if (globalConfig.Android_System_Keyboard &&
                (uiState === 3 || uiState === 4) &&
                edit === 0 &&
                isPointInSprite(guiPos.x, guiPos.y, 652, 5, 'spr_mobile_pad', 2)) {
                vkb_show();
                consumed = true;
            }

            let idx = touchIndices.indexOf(null);
            if (idx !== -1) {
                touchIndices[idx] = t.identifier;
                touches[t.identifier] = {
                    x: guiPos.x,
                    y: guiPos.y,
                    id: t.identifier,
                    pressed: true,
                    deviceIdx: idx,
                    prevOnSettings: false
                };
                // Detecta toque direto no botão settings no evento real (não no rAF)
                trySettingsButtonActivation(touches[t.identifier], guiPos.x, guiPos.y);
            }
        }
        if (consumed) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (!controlsAcceptInput()) return;

        let consumed = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const guiPos = toGUI(t);
            if (edit !== 0 || isTouchOnControl(guiPos.x, guiPos.y)) {
                consumed = true;
            }

            if (touches.hasOwnProperty(t.identifier)) {
                touches[t.identifier].x = guiPos.x;
                touches[t.identifier].y = guiPos.y;
                // Detecta arraste até o botão settings no evento real (não no rAF)
                trySettingsButtonActivation(touches[t.identifier], guiPos.x, guiPos.y);
            }
        }
        if (consumed) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', e => {
        if (!controlsAcceptInput()) return;

        let consumed = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const guiPos = toGUI(t);
            if (edit !== 0 || isTouchOnControl(guiPos.x, guiPos.y)) {
                consumed = true;
            }

            let idx = touchIndices.indexOf(t.identifier);
            if (idx !== -1) touchIndices[idx] = null;
            delete touches[t.identifier];
        }
        if (consumed) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchcancel', () => {
        touchIndices = [null, null, null, null, null];
        for (const key in touches) {
            if (touches.hasOwnProperty(key)) {
                delete touches[key];
            }
        }
    });

    let mouseDown = false;

    document.addEventListener('mousedown', e => {
        initAudio();
        if (!controlsAcceptInput() || e.button !== 0) return;
        mouseDown = true;
        const guiPos = toGUI(e);
        touches['mouse'] = {
            x: guiPos.x,
            y: guiPos.y,
            id: 'mouse',
            pressed: true,
            prevOnSettings: false
        };
    });

    document.addEventListener('mousemove', e => {
        if (!controlsAcceptInput() || !mouseDown) return;
        const guiPos = toGUI(e);
        if (touches.hasOwnProperty('mouse')) {
            touches['mouse'].x = guiPos.x;
            touches['mouse'].y = guiPos.y;
        }
    });

    window.addEventListener('mouseup', () => {
        mouseDown = false;
        delete touches['mouse'];
		delete mobilePadTouchStates['mouse'];
    });

    requestAnimationFrame(loop);

    loadMKState();
    pollScratchReady();

    function pauseGame() {
        // Define gameIsPaused = true ANTES de suspender qualquer áudio
        gameIsPaused = true;
        
        // Suspende o audioCtx dos controles MK
        if (audioCtx) {
            audioCtx.suspend();
        }
        
        const vm = window.vm || (window.scaffolding && window.scaffolding.vm);
        if (!vm) return;
        
        if (typeof vm.pause === 'function') {
            vm.pause();
        } else if (window.scaffolding && typeof window.scaffolding.pause === 'function') {
            window.scaffolding.pause();
        } else {
            // Manual Pause Polyfill
            if (vm.runtime) {
                if (!oldStep && typeof vm.runtime._step === 'function') {
                    oldStep = vm.runtime._step;
                    vm.runtime._step = function() {
                        if (gameIsPaused) return;
                        return oldStep.apply(this, arguments);
                    };
                }
                if (vm.runtime.audioEngine && vm.runtime.audioEngine.audioContext) {
                    vm.runtime.audioEngine.audioContext.suspend();
                }
                if (vm.runtime.ioDevices && vm.runtime.ioDevices.clock && typeof vm.runtime.ioDevices.clock.pause === 'function') {
                    vm.runtime.ioDevices.clock.pause();
                }
            }
        }
    }

    function resumeGame() {
        const vm = window.vm || (window.scaffolding && window.scaffolding.vm);
        
        // Define gameIsPaused = false ANTES de resumir qualquer áudio
        gameIsPaused = false;
        
        // Resume o audioCtx dos controles MK
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        if (!vm) return;

        if (typeof vm.resume === 'function') {
            vm.resume();
        } else if (window.scaffolding && typeof window.scaffolding.resume === 'function') {
            window.scaffolding.resume();
        } else {
            // Manual Resume Polyfill
            if (vm.runtime) {
                if (vm.runtime.audioEngine && vm.runtime.audioEngine.audioContext) {
                    vm.runtime.audioEngine.audioContext.resume();
                }
                if (vm.runtime.ioDevices && vm.runtime.ioDevices.clock && typeof vm.runtime.ioDevices.clock.resume === 'function') {
                    vm.runtime.ioDevices.clock.resume();
                }
            }
        }
    }

    document.addEventListener('pause', pauseGame, false);
    document.addEventListener('resume', resumeGame, false);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseGame();
        } else {
            resumeGame();
        }
    }, false);

})();

/* jshint browser:true */
// A polyfill for input[type=datetime-local].
// Designed to be compatible with Chrome and Firefox, Desktop and mobile.
(function() {
    'use strict';
    if (/Mobile|Chrome\//.test(navigator.userAgent)) {
        // Chrome supports input[type=datetime-local] since way before version 30.
        // Firefox for Android supports it too, at least in 53, but probably already
        // way back to 40 and possibly earlier.
        return;
    }

    document.body.addEventListener('focus', function(e) {
        var input = e.target;
        if (input.tagName.toUpperCase() === 'INPUT' &&
            input.getAttribute('type') === 'datetime-local') {
            showDatePickerForInput(input);
        }
    }, true);

    var lastDatePicker = null;
    var dialogId = Math.floor(Date.now() * Math.random());

    // E.g. 2017-04-05T16:18
    function showDatePickerForInput(input) {
        var container = document.createElement('div');
        container.id = 'datetime-local-polyfill-' + (++dialogId);
        container.appendChild(document.createElement('style')).textContent = createStyleSheetText(container.id);
        var d = document.createElement('form');
        d.innerHTML =
            '<div>' +
                '<input class="datetime-local-day" type="number" min="1" max="31" step="1" title="day of month" placeholder="DD" required> - ' +
                '<select class="datetime-local-month" required></select> - ' +
                '<input class="datetime-local-year" type="number" min="0" max="9999" step="1" title="year" placeholder="YYYY" required> , ' +
                '<input class="datetime-local-hour" type="number" min="0" max="23" step="1" title="hours" placeholder="HH"> : ' +
                '<input class="datetime-local-minute" type="number" max="59" step="1" title="minutes" placeholder="MM"> : ' +
                '<input class="datetime-local-second" type="number" max="59" step="1" title="seconds" placeholder="SS">' +
            '</div>' + 
            '<div class="datetime-local-buttonset">' +
                '<input type="button" class="datetime-local-cancel" value="Cancel"> ' +
                '<input type="button" class="datetime-local-now" value="Current time"> ' +
                '<input type="button" class="datetime-local-clear" value="Clear">' +
                '<input type="submit" value="Ok">' +
            '</div>';
        var dayInput = d.querySelector('.datetime-local-day');
        var monthInput = d.querySelector('.datetime-local-month');
        var yearInput = d.querySelector('.datetime-local-year');
        var hourInput = d.querySelector('.datetime-local-hour');
        var minuteInput = d.querySelector('.datetime-local-minute');
        var secondInput = d.querySelector('.datetime-local-second');


        d.querySelector('.datetime-local-cancel').onclick = function(event) {
            event.preventDefault();
            hideDatePicker();
        };
        d.querySelector('.datetime-local-now').onclick = function(event) {
            event.preventDefault();
            useDateForPicker(new Date());
        };
        d.querySelector('.datetime-local-clear').onclick = function(event) {
            event.preventDefault();
            setInputValue('');
            hideDatePicker();
        };
        d.onsubmit = function(event) {
            event.preventDefault();
            setInputValue(uiDateAsValue());
            hideDatePicker();
        };

        getMonthLabels().forEach(function(monthLabel, i) {
            monthInput.appendChild(new Option(monthLabel, i + 1));
        });
        container.appendChild(d);
        document.body.appendChild(container);

        hideDatePicker();
        lastDatePicker = container;
        dayInput.focus();
        useDateForPicker(new Date(input.value));
        window.addEventListener('keydown', onKeyDown, true);

        function setInputValue(value) {
            if (input.value !== value) {
                input.value = value;
                input.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                }));
            }
        }

        function useDateForPicker(date) {
            if (!isNaN(date.getTime())) {
                dayInput.value = date.getDate();
                monthInput.value = date.getMonth() + 1;
                yearInput.value = date.getFullYear();
                hourInput.value = date.getHours();
                minuteInput.value = date.getMinutes();
                secondInput.value = date.getSeconds();
            }
        }

        function uiDateAsValue() {
            return yearInput.value.padStart(4, '0') + '-' +
                monthInput.value.padStart(2, '0') + '-' +
                dayInput.value.padStart(2, '0') + 'T' +
                hourInput.value.padStart(2, '0') + ':' +
                minuteInput.value.padStart(2, '0') + ':' +
                secondInput.value.padStart(2, '0');
        }
    }

    function onKeyDown(event) {
        if (event.keyCode === 27) { // Esc
            hideDatePicker();
        }
    }

    function hideDatePicker() {
        window.removeEventListener('keydown', onKeyDown, true);
        if (lastDatePicker) {
            lastDatePicker.remove();
            lastDatePicker = null;
        }
    }

    function createStyleSheetText(id) {
        var styleSheetText = '';
        function addScopedStyle(selector, cssText) {
            selector = selector.replace(/^|,/g, '$&#' + id + ' ');
            styleSheetText += selector + '{' + cssText + '}';
        }
        addScopedStyle('',
            'position:fixed;top:0;left:0;right:0;bottom:0;' +
            'display:flex;align-items:center;justify-content:center;' +
            'background:rgba(0,0,0,.5);');
        addScopedStyle('div',
            'margin:2rem;');
        addScopedStyle('.datetime-local-buttonset',
            'display:flex;justify-content:space-between;');
        addScopedStyle('form',
            'background:rgba(0,0,0,0.9);color:#EEE;');
        addScopedStyle('input, select',
            'font-size:1rem;' + 
            'line-height:2em;' +
            'text-align:center;');
        addScopedStyle('.datetime-local-day, .datetime-local-hour, .datetime-local-minute, .datetime-local-second',
            'width:6ch;');
        addScopedStyle('.datetime-local-year',
            'width:8ch;');
        return styleSheetText;
    }

    function getMonthLabels() {
        try {
            var months = [];
            var dtf = new Intl.DateTimeFormat(navigator.language, {month:'long'});
            var d = new Date(2000, 1, 1);
            for (var i = 0; i < 12; ++i) {
                d.setMonth(i);
                months[i] = dtf.formatToParts(d).filter(function(part) { return part.type === 'month'; })[0].value;
            }
            return months;
        } catch (e) {
            return [
                'January',
                'February',
                'March',
                'April',
                'May',
                'June',
                'July',
                'August',
                'September',
                'October',
                'November',
                'December',
            ];
        }
    }
})();

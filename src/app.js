// Двигун гри. Весь стан — в одному об'єкті state (у v2 його легко зберегти в localStorage).
(function () {
  'use strict';
  var scenario = JSON.parse(document.getElementById('scenario').textContent);
  var state = { version: 1, step: 0, ticket: null, name: '', answers: {}, scales: {}, choices: {}, stamps: {}, seals: {} };
  document.getElementById('app').textContent = scenario.meta.title + ' — каркас готовий.';
  window.CNAP = { state: state, scenario: scenario };
})();

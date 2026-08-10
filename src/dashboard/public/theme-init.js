if(localStorage.getItem('nex-theme')==='light')document.documentElement.setAttribute('data-theme','light');



document.addEventListener('error', function (e) {
  var el = e.target;
  if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) {
    el.style.display = 'none';
  }
}, true);

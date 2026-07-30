if(localStorage.getItem('nex-theme')==='light')document.documentElement.setAttribute('data-theme','light');

// CSP script-src 'self' chan onerror inline. Su kien 'error' cua <img> khong bubble,
// nhung CO the bat o giai doan capture — nen mot listener duy nhat o day phuc vu ca trang.
document.addEventListener('error', function (e) {
  var el = e.target;
  if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) {
    el.style.display = 'none';
  }
}, true);

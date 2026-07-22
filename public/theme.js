(function() {
  var validBrandThemes = ['cobalt', 'graphite'];
  var brandTheme = 'cobalt';
  try {
    var stored = localStorage.getItem('livejobindex_brand_theme');
    if (validBrandThemes.indexOf(stored) !== -1) brandTheme = stored;
  } catch (e) {
  }
  document.documentElement.setAttribute('data-theme', brandTheme === 'graphite' ? 'dark' : 'light');
  document.documentElement.dataset.brandTheme = brandTheme;
})();

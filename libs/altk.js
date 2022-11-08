let altkImports = null;

let altk_init_script = document.createElement('script');
altk_init_script.setAttribute('src', 'altk-init.js');
document.head.appendChild(altk_init_script);

let Altk = function() {
  this.addImports = function(imports) {
    altkImports = imports;
  }
}

let Altk = new Altk();

while (1) {
  var num1 = prompt("what is the first number")
  var num2 = prompt("what is the second number")
  var result = num1 + num2
  alert("The result is" + result)
  var exit = confirm("do you want to exit?")
  if (exit) continue;
}
  

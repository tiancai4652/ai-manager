export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export function multiply(a, b) {
  return a * b;
}

export function divide(a, b) {
  if (b === 0) {
    console.log('Error: Division by zero');
    process.exit(1);
  }
  return a / b;
}

const operation = process.argv[2];
const num1 = Number(process.argv[3]);
const num2 = Number(process.argv[4]);

if (!operation) {
  console.log('Usage: node calc.js <operation> <num1> <num2>');
  process.exit(0);
}

const operations = { add, subtract, multiply, divide };
const fn = operations[operation];

if (!fn) {
  console.log(`Error: Unknown operation "${operation}"`);
  process.exit(1);
}

const result = fn(num1, num2);
console.log(`Result: ${result}`);

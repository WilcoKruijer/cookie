export function hello() {
  console.log("Hello World!");
}

if (import.meta.main) {
  hello();
}

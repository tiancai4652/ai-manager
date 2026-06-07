const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 提示用户输入一个数字
function askNumber() {
  rl.question('请输入一个数字：', (input) => {
    const num = Number(input);

    // 验证是否为有效数字（排除 NaN 和空字符串等）
    if (isNaN(num) || input.trim() === '') {
      console.log('请输入有效的数字');
      askNumber();
      return;
    }

    // 判断奇偶性
    const result = num % 2 === 0 ? '偶数' : '奇数';
    console.log(`${num} 是${result}`);

    // 询问是否继续
    askContinue();
  });
}

// 询问用户是否继续
function askContinue() {
  rl.question('是否继续？(y 继续，其他退出)：', (input) => {
    if (input.trim().toLowerCase() === 'y') {
      askNumber();
    } else {
      console.log('感谢使用，再见！');
      rl.close();
    }
  });
}

// 启动程序
askNumber();

// 让 React 的 act() 在非打包器注入 IS_REACT_ACT_ENVIRONMENT 的环境（jsdom + vitest）下生效。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

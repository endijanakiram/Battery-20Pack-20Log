declare module 'bwip-js' {
  const bwipjs: {
    toBuffer(options: any): Promise<Buffer>;
  };
  export default bwipjs;
}

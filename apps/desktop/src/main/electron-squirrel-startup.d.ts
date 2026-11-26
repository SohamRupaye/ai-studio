// electron-squirrel-startup ships no types. Its default export is a boolean:
// true when the app was launched by a Squirrel.Windows install/update/uninstall
// shortcut, in which case the caller should quit immediately.
declare module "electron-squirrel-startup" {
  const isSquirrelStartup: boolean;
  export default isSquirrelStartup;
}

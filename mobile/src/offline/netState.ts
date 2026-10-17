// Module-level connectivity flag shared by non-React code (cache, queue).
let online = true;
export const isOnlineNow = () => online;
export const setOnlineNow = (v: boolean) => {
  online = v;
};

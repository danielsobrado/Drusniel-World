/** Alt breaks a tangent's smooth link; elsewhere it carves an opening. */
export function constructionCutIntent(event, handle, armed = false) {
  return Boolean(armed || (event.altKey && handle?.handleKind !== 'tangent'));
}

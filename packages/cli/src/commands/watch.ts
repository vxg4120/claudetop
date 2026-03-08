import React from 'react'
import { render } from 'ink'
import { ProcessTable } from '../components/ProcessTable'

export function watchCommand() {
  render(React.createElement(ProcessTable))
}

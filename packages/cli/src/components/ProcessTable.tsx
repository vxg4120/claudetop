import React, { useState, useEffect } from 'react'
import { Text, Box } from 'ink'
import { ClaudeProcess, watchProcesses } from '@claudetop/core'
import { formatMemory, formatRuntime, formatStatus } from '../utils/format'

export function ProcessTable() {
  const [processes, setProcesses] = useState<ClaudeProcess[]>([])
  const [lastUpdated, setLastUpdated] = useState(new Date())

  useEffect(() => {
    const unsubscribe = watchProcesses(2000, (procs) => {
      setProcesses(procs)
      setLastUpdated(new Date())
    })
    return unsubscribe
  }, [])

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>claudetop </Text>
        <Text dimColor>— updated {lastUpdated.toLocaleTimeString()}</Text>
      </Box>

      <Box>
        {['PID', 'MEM', 'CPU', 'RUNTIME', 'STATUS', 'ARGS'].map((h) => (
          <Box key={h} width={h === 'ARGS' ? 40 : 12}>
            <Text bold>{h}</Text>
          </Box>
        ))}
      </Box>

      {processes.length === 0 ? (
        <Text dimColor>No Claude processes found.</Text>
      ) : (
        processes.map((p) => (
          <Box key={p.pid}>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{p.pid}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{formatMemory(p.memory.rss)}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{p.cpu.toFixed(1)}%</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{formatRuntime(p.runtime)}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : 'green'}>{formatStatus(p.isRunaway, p.status)}</Text></Box>
            <Box width={40}><Text>{p.args.join(' ').substring(0, 38) || '—'}</Text></Box>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}

import { securityScan } from '@claudetop/core'

export async function scanCommand(pid?: number) {
  console.log(`\nRunning security scan${pid ? ` on PID ${pid}` : ' on all Claude processes'}...\n`)

  const report = await securityScan(pid)

  console.log(`Scanned at: ${report.scannedAt.toISOString()}`)
  console.log(`Network connections: ${report.networkConnections.length}`)
  console.log(`Suspicious connections: ${report.suspiciousConnections.length}`)
  console.log(`Open files checked: ${report.openFiles.length}`)
  console.log(`Flagged files: ${report.flaggedFiles.length}`)

  if (report.anomalies.length === 0) {
    console.log('\n✓ No anomalies detected')
  } else {
    console.log('\n⚠ Anomalies:')
    report.anomalies.forEach((a) => console.log(`  - ${a}`))
  }

  if (report.suspiciousConnections.length > 0) {
    console.log('\nSuspicious connections:')
    report.suspiciousConnections.forEach((c) => {
      console.log(`  ${c.remoteAddress}:${c.remotePort} (${c.state})`)
    })
  }

  if (report.flaggedFiles.length > 0) {
    console.log('\nFlagged files:')
    report.flaggedFiles.forEach((f) => console.log(`  ${f}`))
  }

  console.log('')
}

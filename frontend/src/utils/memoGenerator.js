import { jsPDF } from "jspdf";

export const generateMemo = (charts, lastQuery) => {
  const doc = new jsPDF();
  
  // Header
  doc.setFillColor(8, 8, 16);
  doc.rect(0, 0, 210, 40, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.text("City Pulse Policy Memo", 20, 25);
  
  // Body
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(14);
  doc.text(`Subject: ${lastQuery || "General Urban Analysis"}`, 20, 55);
  
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, 65);
  
  doc.setLineWidth(0.5);
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 70, 190, 70);
  
  if (charts) {
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(12);
    doc.text("Executive Summary", 20, 85);
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    
    const summaryText = `This report summarizes recent 311 complaint activity in NYC. We analyzed ${charts.total_complaints} total reports over a ${charts.trends?.length || 0}-day period to identify significant anomalies and urban dynamics.`;
    const splitSummary = doc.splitTextToSize(summaryText, 170);
    doc.text(splitSummary, 20, 95);
    
    let y = 95 + (splitSummary.length * 6) + 10;
    
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(12);
    doc.text("Key Findings & Anomalies", 20, y);
    y += 10;
    
    if (charts.anomalies?.length > 0) {
      doc.setTextColor(220, 38, 38); // Red
      doc.text(`Alert: ${charts.anomalies.length} significant spike(s) detected.`, 20, y);
      y += 10;
      
      doc.setTextColor(80, 80, 80);
      charts.anomalies.forEach((a, i) => {
        doc.text(`• ${a.created_date}: Reached ${a.count} incidents`, 25, y);
        y += 8;
      });
    } else {
      doc.setTextColor(34, 197, 94); // Green
      doc.text("Status: Normal. No significant anomalies detected during this period.", 20, y);
      y += 10;
    }
    
    // Recommendations
    y += 10;
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(12);
    doc.text("Actionable Recommendations", 20, y);
    y += 10;
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("1. Dispatch local field teams to verify conditions at anomaly hotspots.", 20, y); y += 8;
    doc.text("2. Cross-reference 311 data with MTA logs for infrastructure correlations.", 20, y); y += 8;
    doc.text("3. Continue real-time monitoring via City Pulse dashboard.", 20, y);
    
  } else {
    doc.setTextColor(80, 80, 80);
    doc.text("No data available. Ask a question on the dashboard to generate data.", 20, 85);
  }
  
  // Footer
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Powered by Google Gemini 2.5 Flash & NYC Open Data", 105, 280, { align: "center" });
  
  doc.save("City_Pulse_Policy_Memo.pdf");
};

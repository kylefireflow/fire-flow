/**
 * nfpa-checklists.js — NFPA 13 Smart Checklist Data
 */
export const NFPA13_CHECKLISTS = {

  'Wet Pipe Sprinkler': [
    { code:'WP-01', label:'Control Valve Position', description:'All control valves fully open, locked, and supervised.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.2.1' },
    { code:'WP-02', label:'System Pressure at Riser', description:'Record static pressure at the riser gauge.', type:'numeric', required:true,  nfpa:'NFPA 25 5.3.2', unit:'psi' },
    { code:'WP-03', label:'Inspector Test Valve', description:'Valve present, labeled, and accessible.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.3.1' },
    { code:'WP-04', label:'Water Flow Alarm Test', description:'Open inspector test valve — alarm activates within 90 seconds.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.3.3' },
    { code:'WP-05', label:'Sprinkler Head Condition', description:'No painted, corroded, damaged, or loaded heads.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1' },
    { code:'WP-06', label:'18-Inch Clearance', description:'Minimum 18-inch clearance below all sprinkler deflectors.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1' },
    { code:'WP-07', label:'Spare Heads + Wrench On Site', description:'Minimum spare head supply with matching wrench in cabinet.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.4.1' },
    { code:'WP-08', label:'FDC Condition', description:'Fire department connection accessible, capped, unobstructed.', type:'pass_fail', required:true,  nfpa:'NFPA 25 6.3.1' },
    { code:'WP-09', label:'Riser Room Clear', description:'No storage or obstructions around riser or PIV.', type:'pass_fail', required:false, nfpa:'NFPA 25 4.1.2' },
    { code:'WP-10', label:'Main Drain Residual Pressure', description:'Record residual pressure after main drain test.', type:'numeric', required:false, nfpa:'NFPA 25 13.2.5', unit:'psi' },
    { code:'WP-11', label:'General Observations', description:'Note any conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Dry Pipe Sprinkler': [
    { code:'DP-01', label:'Dry Pipe Valve Condition', description:'Valve trim, clapper, and internals in good condition. No leaks.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.3.1' },
    { code:'DP-02', label:'Air Pressure (system side)', description:'Record current air pressure on system side.', type:'numeric', required:true,  nfpa:'NFPA 25 13.3.2', unit:'psi' },
    { code:'DP-03', label:'Water Pressure (supply side)', description:'Record water supply pressure below clapper.', type:'numeric', required:true,  nfpa:'NFPA 25 13.3.2', unit:'psi' },
    { code:'DP-04', label:'Air/Water Differential Ratio', description:'Ratio within manufacturer spec (typically 5.5:1 or 6:1).', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.3.2' },
    { code:'DP-05', label:'Quick-Opening Device', description:'Accelerator or exhauster functional and properly set.', type:'pass_fail', required:false, nfpa:'NFPA 25 13.3.3' },
    { code:'DP-06', label:'Low Point Drains', description:'All drum drips and low-point drains checked for water accumulation.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.3.4' },
    { code:'DP-07', label:'Heat in Valve Room', description:'Room temperature above 40 degrees F.', type:'pass_fail', required:true,  nfpa:'NFPA 25 4.1.3' },
    { code:'DP-08', label:'Sprinkler Head Condition', description:'No painted, corroded, or damaged heads.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1' },
    { code:'DP-09', label:'FDC Condition', description:'Accessible, capped, unobstructed.', type:'pass_fail', required:true,  nfpa:'NFPA 25 6.3.1' },
    { code:'DP-10', label:'General Observations', description:'Note any conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Pre-Action Sprinkler': [
    { code:'PA-01', label:'Pre-Action Valve Condition', description:'Valve trim, supervisory switch, and solenoid in good condition.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.4.1' },
    { code:'PA-02', label:'Detection System Interface', description:'Detection circuit properly connected to releasing panel.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.4.2' },
    { code:'PA-03', label:'Supervisory Air Pressure', description:'Record current supervisory air pressure in piping.', type:'numeric', required:true,  nfpa:'NFPA 25 13.4.3', unit:'psi' },
    { code:'PA-04', label:'Solenoid Valve Operation', description:'Solenoid valve opens on alarm signal within acceptable time.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.4.4' },
    { code:'PA-05', label:'Manual Release Accessible', description:'Emergency manual release clearly labeled and accessible.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.4.5' },
    { code:'PA-06', label:'Sprinkler Head Condition', description:'No painted, corroded, or obstructed heads.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1' },
    { code:'PA-07', label:'Control Valve Supervised', description:'Control valve fully open, locked or electrically supervised.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.2.1' },
    { code:'PA-08', label:'General Observations', description:'Note any conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Deluge System': [
    { code:'DL-01', label:'Deluge Valve Condition', description:'Valve, trim, and releasing trim in good condition. No leaks.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.5.1' },
    { code:'DL-02', label:'Detection Releasing Circuit', description:'Automatic detection circuit functional and properly wired.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.5.2' },
    { code:'DL-03', label:'Nozzle Condition', description:'All open nozzles free of debris, properly aimed, unobstructed.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.5.3' },
    { code:'DL-04', label:'Water Supply Pressure', description:'Record water supply static pressure at the riser.', type:'numeric', required:true,  nfpa:'NFPA 25 13.5.4', unit:'psi' },
    { code:'DL-05', label:'Manual Release Accessible', description:'Emergency manual release labeled and accessible.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.5.5' },
    { code:'DL-06', label:'Solenoid and Strainer', description:'Solenoid operates on command; strainer clean.', type:'pass_fail', required:false, nfpa:'NFPA 25 13.5.6' },
    { code:'DL-07', label:'General Observations', description:'Note any conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Backflow Preventer': [
    { code:'BF-01', label:'Inlet Shutoff Valve Open', description:'Upstream shutoff fully open and supervised/locked.', type:'pass_fail', required:true,  nfpa:'NFPA 25 12.1.1' },
    { code:'BF-02', label:'Outlet Shutoff Valve Open', description:'Downstream shutoff fully open and supervised/locked.', type:'pass_fail', required:true,  nfpa:'NFPA 25 12.1.1' },
    { code:'BF-03', label:'Differential Pressure Check 1', description:'Record differential pressure across check valve 1.', type:'numeric', required:true,  nfpa:'NFPA 25 12.3', unit:'psi' },
    { code:'BF-04', label:'Differential Pressure Check 2', description:'Record differential pressure across check valve 2.', type:'numeric', required:true,  nfpa:'NFPA 25 12.3', unit:'psi' },
    { code:'BF-05', label:'Relief Valve Operation', description:'Relief valve opens at correct differential and reseats properly.', type:'pass_fail', required:true,  nfpa:'NFPA 25 12.3.3' },
    { code:'BF-06', label:'No Visible Leaks', description:'No leaks from body, relief port, or test cocks.', type:'pass_fail', required:true,  nfpa:'NFPA 25 12.1.2' },
    { code:'BF-07', label:'General Observations', description:'Note any conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Control Valves': [
    { code:'CV-01', label:'All Valves Fully Open', description:'Every control valve in the system is fully open.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.2.1' },
    { code:'CV-02', label:'Valves Locked or Supervised', description:'Each valve is locked open or electrically supervised.', type:'pass_fail', required:true,  nfpa:'NFPA 25 13.2.2' },
    { code:'CV-03', label:'OS&Y Valve Condition', description:'Stem fully extended, no corrosion, handle accessible.', type:'pass_fail', required:false, nfpa:'NFPA 25 13.2.3' },
    { code:'CV-04', label:'PIV / Butterfly Valve Condition', description:'Indicator reads OPEN, properly set.', type:'pass_fail', required:false, nfpa:'NFPA 25 13.2.4' },
    { code:'CV-05', label:'Valve Tags Present', description:'Each valve tagged with ID number and last inspection date.', type:'pass_fail', required:true,  nfpa:'NFPA 25 4.1.2' },
    { code:'CV-06', label:'General Observations', description:'Note any valve conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Alarm Devices': [
    { code:'AD-01', label:'Waterflow Alarm Activates', description:'Open inspector test valve — alarm sounds within 90 seconds.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.3.3' },
    { code:'AD-02', label:'Alarm Gong / Bell Condition', description:'Mechanical alarm gong or bell free of damage and obstruction.', type:'pass_fail', required:false, nfpa:'NFPA 25 5.3.4' },
    { code:'AD-03', label:'Pressure / Flow Switch', description:'Electrical waterflow switches operational and wired to monitoring.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.3.5' },
    { code:'AD-04', label:'Supervisory Alarm Devices', description:'Tamper switches generate supervisory signal at panel.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.3.6' },
    { code:'AD-05', label:'Central Station Monitoring', description:'Monitoring agency confirms receipt of test alarm signal.', type:'pass_fail', required:true,  nfpa:'NFPA 72 26.6' },
    { code:'AD-06', label:'Retard Chamber Drains', description:'Retard chamber (if present) drains properly after test.', type:'pass_fail', required:false, nfpa:'NFPA 25 5.3.7' },
    { code:'AD-07', label:'General Observations', description:'Note any alarm device conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Sprinkler Heads': [
    { code:'SH-01', label:'No Painted Heads', description:'No heads showing evidence of paint or overspray.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1.1' },
    { code:'SH-02', label:'No Corroded Heads', description:'No heads with corrosion, rust, or mineral deposits.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1.2' },
    { code:'SH-03', label:'No Loaded or Damaged Heads', description:'No heads with grease, dust loading, or mechanical damage.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1.3' },
    { code:'SH-04', label:'18-Inch Clearance Maintained', description:'18-inch clearance from deflector to top of storage.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.1' },
    { code:'SH-05', label:'No Missing Heads', description:'No missing heads; all escutcheons properly seated.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.2' },
    { code:'SH-06', label:'Head Orientation Correct', description:'Upright, pendent, or sidewall heads installed in correct orientation.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.2.3' },
    { code:'SH-07', label:'Spare Heads On Site', description:'Minimum 6 spare heads of each type installed, with wrench.', type:'pass_fail', required:true,  nfpa:'NFPA 25 5.4.1' },
    { code:'SH-08', label:'General Observations', description:'Note any head conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

  'Piping & Hangers': [
    { code:'PH-01', label:'No Mechanical Damage', description:'No dents, gouges, or deformation to any pipe section.', type:'pass_fail', required:true,  nfpa:'NFPA 25 14.2.1' },
    { code:'PH-02', label:'No Corrosion or MIC', description:'No external corrosion, leaks, or MIC staining.', type:'pass_fail', required:true,  nfpa:'NFPA 25 14.2.2' },
    { code:'PH-03', label:'Pipe Hangers Intact', description:'All hangers and supports secured; none missing, loose, or bent.', type:'pass_fail', required:true,  nfpa:'NFPA 25 14.3.1' },
    { code:'PH-04', label:'Hanger Spacing Acceptable', description:'No spans exceeding NFPA 13 hanger interval table for pipe size.', type:'pass_fail', required:false, nfpa:'NFPA 13 17.4' },
    { code:'PH-05', label:'Seismic Bracing Intact', description:'All seismic sway bracing present, oriented correctly, undamaged.', type:'pass_fail', required:false, nfpa:'NFPA 13 18.5' },
    { code:'PH-06', label:'No Unauthorized Modifications', description:'No field cuts or joints outside original design.', type:'pass_fail', required:true,  nfpa:'NFPA 25 4.1.2' },
    { code:'PH-07', label:'General Observations', description:'Note any piping or hanger conditions not covered above.', type:'notes', required:false, nfpa:'NFPA 25 4.1' },
  ],

};

import 'dart:io';

import 'package:flutter/foundation.dart';

import '../core/errors.dart';
import 'connection.dart';
import 'transfer.dart' as transfer;

class TransferEntry {
  TransferEntry(this.label);

  final String label;
  double? progress = 0; // null once it has failed
  String? error;
}

/// Uploads in progress (and failed ones, kept until dismissed) for the laptop detail screen.
class TransferQueue extends ChangeNotifier {
  final List<TransferEntry> entries = [];

  Future<void> sendFile(LaptopConnection connection, File file, String name) async {
    final entry = TransferEntry(name);
    entries.add(entry);
    notifyListeners();
    try {
      await transfer.sendFile(connection, file, name, onProgress: (done, total) {
        entry.progress = total == 0 ? 0 : done / total;
        notifyListeners();
      });
      entries.remove(entry);
    } on Object catch (error) {
      entry
        ..progress = null
        ..error = userMessage(error);
    }
    notifyListeners();
  }

  void dismiss(TransferEntry entry) {
    entries.remove(entry);
    notifyListeners();
  }
}

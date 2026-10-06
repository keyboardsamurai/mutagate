import java.nio.file.*;
import org.pitest.reloc.asm.*;

// Corpus generation only: make PIT's engine visit compiler-synthetic members.
// Instructions, descriptors, line tables and method bodies remain untouched.
public class ExposeSynthetics {
  public static void main(String[] args) throws Exception {
    try (var paths = Files.walk(Path.of(args[0]))) {
      for (var file : paths.filter(p -> p.toString().endsWith(".class")).toList()) {
        var writer = new ClassWriter(0);
        var visitor = new ClassVisitor(Opcodes.ASM9, writer) {
          @Override public void visit(int version, int access, String name, String signature, String parent, String[] interfaces) {
            super.visit(version, access & ~Opcodes.ACC_SYNTHETIC, name, signature, parent, interfaces);
          }
          @Override public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
            return super.visitMethod(access & ~Opcodes.ACC_SYNTHETIC, name, descriptor, signature, exceptions);
          }
        };
        new ClassReader(Files.readAllBytes(file)).accept(visitor, 0);
        Files.write(file, writer.toByteArray());
      }
    }
  }
}
